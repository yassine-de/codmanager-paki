-- Real, per-agent notifications for confirmation agents, replacing the
-- static mock data agents were seeing in the bell icon. Four kinds:
--   1. order_delivered  — an order they confirmed was delivered (event)
--   2. order_returned   — an order they confirmed came back / returned (event)
--   3. postponed_due    — an order they postponed is now ready to retry (sweep)
--   4. rank_moved       — their confirmation-rate ranking changed (sweep)
-- Additive only: new table, new columns on the existing agent_settings
-- table, two new triggers on orders (both scoped to confirmation_status =
-- 'confirmed' AND agent_id IS NOT NULL, so they only ever fire for orders a
-- confirmation agent actually confirmed), one new scheduled function reusing
-- the existing pg_cron direct-SQL-call pattern already used elsewhere.

CREATE TABLE IF NOT EXISTS public.agent_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('order_delivered', 'order_returned', 'postponed_due', 'rank_moved')),
  title text NOT NULL,
  message text NOT NULL,
  order_id text,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_notifications_agent ON public.agent_notifications (agent_id, created_at DESC);

ALTER TABLE public.agent_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent read own notifications"
ON public.agent_notifications FOR SELECT TO authenticated
USING (agent_id = auth.uid());

CREATE POLICY "agent mark own notifications read"
ON public.agent_notifications FOR UPDATE TO authenticated
USING (agent_id = auth.uid()) WITH CHECK (agent_id = auth.uid());

CREATE POLICY "admin manage agent notifications"
ON public.agent_notifications FOR ALL TO authenticated
USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- Track each agent's last-known rank so the sweep can detect a change.
ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS last_known_rank integer;

-- ── Event trigger: order she confirmed got delivered ────────────────────
CREATE OR REPLACE FUNCTION public.notify_agent_order_delivered()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.confirmation_status = 'confirmed'
     AND NEW.agent_id IS NOT NULL
     AND NEW.delivery_status = 'delivered'
     AND OLD.delivery_status IS DISTINCT FROM 'delivered'
  THEN
    INSERT INTO public.agent_notifications (agent_id, type, title, message, order_id, dedupe_key)
    VALUES (
      NEW.agent_id, 'order_delivered', 'Order Delivered',
      'Order ' || NEW.order_id || ' you confirmed was delivered',
      NEW.order_id, 'delivered:' || NEW.order_id
    )
    ON CONFLICT (agent_id, dedupe_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_agent_order_delivered ON public.orders;
CREATE TRIGGER trg_notify_agent_order_delivered
AFTER UPDATE OF delivery_status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.notify_agent_order_delivered();

-- ── Event trigger: order she confirmed came back / returned ─────────────
CREATE OR REPLACE FUNCTION public.notify_agent_order_returned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.confirmation_status = 'confirmed'
     AND NEW.agent_id IS NOT NULL
     AND NEW.delivery_status IN ('return', 'return_received', 'returned')
     AND OLD.delivery_status IS DISTINCT FROM NEW.delivery_status
     AND COALESCE(OLD.delivery_status, '') NOT IN ('return', 'return_received', 'returned')
  THEN
    INSERT INTO public.agent_notifications (agent_id, type, title, message, order_id, dedupe_key)
    VALUES (
      NEW.agent_id, 'order_returned', 'Order Returned',
      'Order ' || NEW.order_id || ' you confirmed was returned',
      NEW.order_id, 'returned:' || NEW.order_id
    )
    ON CONFLICT (agent_id, dedupe_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_agent_order_returned ON public.orders;
CREATE TRIGGER trg_notify_agent_order_returned
AFTER UPDATE OF delivery_status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.notify_agent_order_returned();

-- ── Scheduled sweep: postponed-due + rank changes ────────────────────────
-- Direct SQL, called by pg_cron every 5 minutes — same pattern already used
-- for process_agent_switch_timeouts(). Does not touch orders/agent_settings
-- rows beyond what's described above (dedupe_key/last_known_rank only).
CREATE OR REPLACE FUNCTION public.sweep_agent_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_rank_row record;
  v_rank integer;
BEGIN
  -- Postponed order became due for retry.
  INSERT INTO public.agent_notifications (agent_id, type, title, message, order_id, dedupe_key)
  SELECT o.original_agent_id, 'postponed_due', 'Postponed Order Ready',
         'Order ' || o.order_id || ' you postponed is ready now',
         o.order_id, 'postponed_due:' || o.order_id
  FROM public.orders o
  WHERE o.confirmation_status = 'postponed'
    AND o.agent_id IS NULL
    AND o.original_agent_id IS NOT NULL
    AND o.postpone_date IS NOT NULL
    AND o.postpone_date <= v_now
  ON CONFLICT (agent_id, dedupe_key) DO NOTHING;

  -- Ranking changes (today, PKT-aligned via get_agent_rankings' own date params).
  v_rank := 0;
  FOR v_rank_row IN
    SELECT agent_id FROM public.get_agent_rankings(date_trunc('day', v_now AT TIME ZONE 'Asia/Karachi') AT TIME ZONE 'Asia/Karachi', v_now)
  LOOP
    v_rank := v_rank + 1;

    UPDATE public.agent_settings ags
    SET last_known_rank = v_rank, updated_at = v_now
    WHERE ags.agent_id = v_rank_row.agent_id
      AND ags.last_known_rank IS DISTINCT FROM v_rank;

    IF FOUND THEN
      INSERT INTO public.agent_notifications (agent_id, type, title, message, dedupe_key)
      VALUES (
        v_rank_row.agent_id, 'rank_moved', 'Ranking Updated',
        'You are now #' || v_rank || ' in today''s ranking',
        'rank_moved:' || to_char(v_now AT TIME ZONE 'Asia/Karachi', 'YYYY-MM-DD') || ':' || v_rank
      )
      ON CONFLICT (agent_id, dedupe_key) DO NOTHING;
    ELSIF NOT EXISTS (SELECT 1 FROM public.agent_settings WHERE agent_id = v_rank_row.agent_id) THEN
      INSERT INTO public.agent_settings (agent_id, last_known_rank)
      VALUES (v_rank_row.agent_id, v_rank)
      ON CONFLICT (agent_id) DO UPDATE SET last_known_rank = EXCLUDED.last_known_rank;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_agent_notifications() FROM PUBLIC, anon, authenticated;

-- One-time bootstrap: record everyone's CURRENT rank without notifying, so
-- the first real sweep run only fires rank_moved for genuine future changes
-- rather than treating "first time we ever measured this" as a change.
DO $bootstrap$
DECLARE
  v_row record;
  v_rank integer := 0;
BEGIN
  FOR v_row IN
    SELECT agent_id FROM public.get_agent_rankings(
      date_trunc('day', now() AT TIME ZONE 'Asia/Karachi') AT TIME ZONE 'Asia/Karachi', now()
    )
  LOOP
    v_rank := v_rank + 1;
    INSERT INTO public.agent_settings (agent_id, last_known_rank)
    VALUES (v_row.agent_id, v_rank)
    ON CONFLICT (agent_id) DO UPDATE SET last_known_rank = EXCLUDED.last_known_rank
    WHERE public.agent_settings.last_known_rank IS NULL;
  END LOOP;
END;
$bootstrap$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agent-notifications-sweep') THEN
    PERFORM cron.unschedule('agent-notifications-sweep');
  END IF;
END $$;

SELECT cron.schedule('agent-notifications-sweep', '*/5 * * * *', $$SELECT public.sweep_agent_notifications();$$);

NOTIFY pgrst, 'reload schema';
