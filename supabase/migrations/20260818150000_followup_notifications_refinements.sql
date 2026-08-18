-- Two refinements to follow_up_notifications (see 20260818130000):
--   1. followup_no_answer_attempt — fires on EACH no_answer attempt
--      (fu_no_answer_count = 1..5), not just a time-based reminder, so the
--      agent sees every attempt tick up, with a stronger framing at 5.
--   2. followup_reattempt_stale — an order marked re_attempted that's still
--      not delivered 24h+ later; reminds again every 24h while unresolved,
--      same repeating-bucket mechanism as the existing 4h no_answer/
--      pushed_delivery reminder.
-- Both additive: new type values, new trigger, and the existing sweep
-- function gets a second loop appended (same cron job, no new schedule).

ALTER TABLE public.follow_up_notifications DROP CONSTRAINT IF EXISTS follow_up_notifications_type_check;
ALTER TABLE public.follow_up_notifications ADD CONSTRAINT follow_up_notifications_type_check
  CHECK (type IN (
    'followup_assigned', 'followup_stale', 'followup_delivered', 'followup_returned',
    'followup_no_answer_attempt', 'followup_reattempt_stale'
  ));

-- ── followup_no_answer_attempt ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_followup_no_answer_attempt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assigned_to uuid;
BEGIN
  IF NEW.follow_up_status = 'no_answer' AND NEW.fu_no_answer_count BETWEEN 1 AND 5 THEN
    SELECT o.follow_up_assigned_to INTO v_assigned_to
    FROM public.orders o WHERE o.order_id = NEW.order_id;

    IF v_assigned_to IS NOT NULL THEN
      INSERT INTO public.follow_up_notifications (follow_up_user_id, type, title, message, order_id, dedupe_key)
      VALUES (
        v_assigned_to, 'followup_no_answer_attempt',
        CASE WHEN NEW.fu_no_answer_count = 5 THEN 'Final No Answer Attempt' ELSE 'No Answer Attempt ' || NEW.fu_no_answer_count END,
        'Order ' || NEW.order_id || ' — no answer attempt ' || NEW.fu_no_answer_count || '/5'
          || CASE WHEN NEW.fu_no_answer_count = 5 THEN ' — still unreached, consider escalating' ELSE ', try again' END,
        NEW.order_id, 'followup_no_answer_attempt:' || NEW.order_id || ':' || NEW.fu_no_answer_count
      )
      ON CONFLICT (follow_up_user_id, dedupe_key) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_followup_no_answer_attempt ON public.order_follow_ups;
CREATE TRIGGER trg_notify_followup_no_answer_attempt
AFTER INSERT OR UPDATE OF follow_up_status, fu_no_answer_count ON public.order_follow_ups
FOR EACH ROW
EXECUTE FUNCTION public.notify_followup_no_answer_attempt();

-- ── sweep: add followup_reattempt_stale alongside the existing loop ──────
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

  -- Re-attempted but still not delivered 24h+ later; re-reminds every 24h.
  FOR v_row IN
    SELECT fu.order_id, o.order_id AS display_order_id, o.follow_up_assigned_to, o.delivery_status, fu.updated_at
    FROM public.order_follow_ups fu
    JOIN public.orders o ON o.order_id = fu.order_id
    WHERE fu.follow_up_status = 're_attempted'
      AND o.follow_up_assigned_to IS NOT NULL
      AND COALESCE(o.delivery_status, '') NOT IN ('delivered', 'paid')
      AND fu.updated_at <= now() - interval '24 hours'
  LOOP
    v_hours_stale := floor(extract(epoch FROM (now() - v_row.updated_at)) / 3600);
    IF v_hours_stale >= 24 AND v_hours_stale % 24 = 0 THEN
      INSERT INTO public.follow_up_notifications (follow_up_user_id, type, title, message, order_id, dedupe_key)
      VALUES (
        v_row.follow_up_assigned_to, 'followup_reattempt_stale', 'Still Not Delivered',
        'Order ' || v_row.display_order_id || ' was re-attempted ' || (v_hours_stale / 24) || 'd ago and is still not delivered',
        v_row.display_order_id, 'followup_reattempt_stale:' || v_row.display_order_id || ':' || v_hours_stale
      )
      ON CONFLICT (follow_up_user_id, dedupe_key) DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
