-- assign_follow_up_agent_for_order() is only ever invoked once, at the exact
-- moment an order's delivery_status transitions to a follow-up-eligible
-- value (via trigger orders_auto_assign_follow_up_agent). If no eligible
-- agent exists at that instant (e.g. the only active agent has
-- receives_new_orders off, or the order's follow-up-started timestamp
-- predates every active agent's assignment_started_at cutoff at the time),
-- the order is never retried and sits unassigned forever — confirmed live:
-- 887 unassigned-but-eligible orders, 289 of which the assignment function
-- itself resolves correctly when called manually (proving the logic isn't
-- broken, it's just never re-invoked).
--
-- This adds a periodic sweep that retries assignment for every currently
-- unassigned+eligible order. It reuses assign_follow_up_agent_for_order()
-- as-is (no logic duplicated), so orders that still have no valid
-- candidate — e.g. the ~598 that predate every active agent's cutoff —
-- correctly stay unassigned rather than being force-assigned.

CREATE OR REPLACE FUNCTION public.sweep_unassigned_followup_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_assigned integer := 0;
BEGIN
  FOR v_order_id IN
    SELECT o.id
    FROM public.orders o
    WHERE o.follow_up_assigned_to IS NULL
      AND public.is_follow_up_delivery_status(o.delivery_status)
    ORDER BY o.updated_at ASC
    LIMIT 2000
  LOOP
    IF public.assign_follow_up_agent_for_order(v_order_id) IS NOT NULL THEN
      v_assigned := v_assigned + 1;
    END IF;
  END LOOP;
  RETURN v_assigned;
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_unassigned_followup_orders() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep-unassigned-followup-orders') THEN
    PERFORM cron.unschedule('sweep-unassigned-followup-orders');
  END IF;
END $$;

SELECT cron.schedule('sweep-unassigned-followup-orders', '*/15 * * * *', $$SELECT public.sweep_unassigned_followup_orders();$$);
