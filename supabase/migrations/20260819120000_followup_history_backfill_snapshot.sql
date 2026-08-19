-- One-time backfill: order_follow_ups only ever stores the latest touch
-- per order (no history trail existed before the follow_up_status logging
-- fix in 47d8be6), so any order touched on multiple different days has its
-- earlier days' credit silently overwritten every time it's touched again
-- — confirmed live: a follow-up agent's "yesterday" count shrank from 86
-- to 63 as some of those orders got re-touched today, since the old
-- timestamp simply doesn't exist anymore.
--
-- This freezes today's already-observed follow_up_status per order into
-- order_history as a one-time snapshot, dated at the order's real last
-- touch (fu.updated_at) and attributed to the real agent (fu.updated_by),
-- so per-agent stats (which key off changed_by + field_changed) count it
-- correctly. It does NOT recover the true historical attempt count for
-- days before this fix went live — that data was never captured and can't
-- be reconstructed — it only stops further drift for orders whose current
-- state is captured here. action_type is distinct from real agent actions
-- (followup_backfill_snapshot vs follow_up_status_change) so the
-- Order History modal can label it as a system snapshot, not imply the
-- agent performed this specific action at this exact moment.

INSERT INTO public.order_history (order_id, changed_by, changed_by_role, field_changed, old_value, new_value, action_type, created_at)
SELECT
  fu.order_id, fu.updated_by, 'follow_up', 'follow_up_status', NULL, fu.follow_up_status,
  'followup_backfill_snapshot', fu.updated_at
FROM public.order_follow_ups fu
WHERE fu.follow_up_status IS NOT NULL AND fu.follow_up_status <> 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM public.order_history oh
    WHERE oh.order_id = fu.order_id AND oh.field_changed = 'follow_up_status'
  );
