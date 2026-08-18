-- Real, per-follow-up-agent notifications. Follow-Up 1's order_follow_ups
-- table has no "retry at" timestamp (unlike the deleted Follow-Up 2), so
-- the stale/reattempt reminder is based on how long an order has sat
-- untouched (updated_at), not a precise due time. Four kinds:
--   1. followup_assigned  — a new order was assigned to them (event)
--   2. followup_stale     — a no_answer/pushed_delivery order has sat
--                           untouched 4+ hours; re-reminds every 4h while
--                           it remains unactioned (sweep)
--   3. followup_delivered — a "Saved Order": they genuinely re-attempted
--                           (follow_up_status='re_attempted') and it was
--                           later delivered — same definition already used
--                           by FollowUpDashboard.tsx's own Saved Orders
--                           card, so this never disagrees with it (event)
--   4. followup_returned  — the counterpart: they re-attempted but it came
--                           back anyway (event)

CREATE TABLE IF NOT EXISTS public.follow_up_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follow_up_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('followup_assigned', 'followup_stale', 'followup_delivered', 'followup_returned')),
  title text NOT NULL,
  message text NOT NULL,
  order_id text,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (follow_up_user_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_follow_up_notifications_user ON public.follow_up_notifications (follow_up_user_id, created_at DESC);

ALTER TABLE public.follow_up_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "follow_up read own notifications"
ON public.follow_up_notifications FOR SELECT TO authenticated
USING (follow_up_user_id = auth.uid());

CREATE POLICY "follow_up mark own notifications read"
ON public.follow_up_notifications FOR UPDATE TO authenticated
USING (follow_up_user_id = auth.uid()) WITH CHECK (follow_up_user_id = auth.uid());

CREATE POLICY "admin manage follow_up notifications"
ON public.follow_up_notifications FOR ALL TO authenticated
USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- ── followup_assigned ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_followup_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.follow_up_assigned_to IS NOT NULL
     AND OLD.follow_up_assigned_to IS DISTINCT FROM NEW.follow_up_assigned_to
  THEN
    INSERT INTO public.follow_up_notifications (follow_up_user_id, type, title, message, order_id, dedupe_key)
    VALUES (
      NEW.follow_up_assigned_to, 'followup_assigned', 'New Order Assigned',
      'Order ' || NEW.order_id || ' was assigned to you for follow-up',
      NEW.order_id, 'followup_assigned:' || NEW.order_id || ':' || NEW.follow_up_assigned_to
    )
    ON CONFLICT (follow_up_user_id, dedupe_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_followup_assigned ON public.orders;
CREATE TRIGGER trg_notify_followup_assigned
AFTER UPDATE OF follow_up_assigned_to ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.notify_followup_assigned();

-- ── followup_delivered (Saved Order) / followup_returned ─────────────────
CREATE OR REPLACE FUNCTION public.notify_followup_order_delivered()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.follow_up_assigned_to IS NOT NULL
     AND NEW.delivery_status IN ('delivered', 'paid')
     AND OLD.delivery_status IS DISTINCT FROM NEW.delivery_status
     AND COALESCE(OLD.delivery_status, '') NOT IN ('delivered', 'paid')
     AND EXISTS (
       SELECT 1 FROM public.order_follow_ups fu
       WHERE fu.order_id = NEW.order_id AND fu.follow_up_status = 're_attempted'
     )
  THEN
    INSERT INTO public.follow_up_notifications (follow_up_user_id, type, title, message, order_id, dedupe_key)
    VALUES (
      NEW.follow_up_assigned_to, 'followup_delivered', 'Saved Order!',
      'Order ' || NEW.order_id || ' you followed up on was delivered',
      NEW.order_id, 'followup_delivered:' || NEW.order_id
    )
    ON CONFLICT (follow_up_user_id, dedupe_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_followup_order_delivered ON public.orders;
CREATE TRIGGER trg_notify_followup_order_delivered
AFTER UPDATE OF delivery_status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.notify_followup_order_delivered();

CREATE OR REPLACE FUNCTION public.notify_followup_order_returned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.follow_up_assigned_to IS NOT NULL
     AND NEW.delivery_status IN ('return', 'return_received', 'returned')
     AND OLD.delivery_status IS DISTINCT FROM NEW.delivery_status
     AND COALESCE(OLD.delivery_status, '') NOT IN ('return', 'return_received', 'returned')
     AND EXISTS (
       SELECT 1 FROM public.order_follow_ups fu
       WHERE fu.order_id = NEW.order_id AND fu.follow_up_status = 're_attempted'
     )
  THEN
    INSERT INTO public.follow_up_notifications (follow_up_user_id, type, title, message, order_id, dedupe_key)
    VALUES (
      NEW.follow_up_assigned_to, 'followup_returned', 'Order Returned',
      'Order ' || NEW.order_id || ' you followed up on was returned',
      NEW.order_id, 'followup_returned:' || NEW.order_id
    )
    ON CONFLICT (follow_up_user_id, dedupe_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_followup_order_returned ON public.orders;
CREATE TRIGGER trg_notify_followup_order_returned
AFTER UPDATE OF delivery_status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.notify_followup_order_returned();

-- ── followup_stale sweep — reminds every 4h while unactioned ─────────────
CREATE OR REPLACE FUNCTION public.sweep_followup_stale_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_hours_stale integer;
BEGIN
  FOR v_row IN
    SELECT fu.order_id, o.order_id AS display_order_id, o.follow_up_assigned_to, fu.follow_up_status, fu.updated_at
    FROM public.order_follow_ups fu
    JOIN public.orders o ON o.order_id = fu.order_id
    WHERE fu.follow_up_status IN ('no_answer', 'pushed_delivery')
      AND o.follow_up_assigned_to IS NOT NULL
      AND fu.updated_at <= now() - interval '4 hours'
  LOOP
    v_hours_stale := floor(extract(epoch FROM (now() - v_row.updated_at)) / 3600);
    IF v_hours_stale >= 4 AND v_hours_stale % 4 = 0 THEN
      INSERT INTO public.follow_up_notifications (follow_up_user_id, type, title, message, order_id, dedupe_key)
      VALUES (
        v_row.follow_up_assigned_to, 'followup_stale', 'Needs Reattempt',
        'Order ' || v_row.display_order_id || ' has been ' || v_row.follow_up_status || ' for ' || v_hours_stale || 'h — reattempt now',
        v_row.display_order_id, 'followup_stale:' || v_row.display_order_id || ':' || v_hours_stale
      )
      ON CONFLICT (follow_up_user_id, dedupe_key) DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_followup_stale_notifications() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'followup-stale-notifications-sweep') THEN
    PERFORM cron.unschedule('followup-stale-notifications-sweep');
  END IF;
END $$;

SELECT cron.schedule('followup-stale-notifications-sweep', '*/15 * * * *', $$SELECT public.sweep_followup_stale_notifications();$$);

NOTIFY pgrst, 'reload schema';
