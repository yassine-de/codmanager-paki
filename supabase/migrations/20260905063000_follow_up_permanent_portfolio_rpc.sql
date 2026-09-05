-- get_follow_ups_data() is the LIVE WORK QUEUE: it deliberately drops orders
-- once they no longer need active attention (delivered with no pending
-- follow-up, shipped <2 days ago and still pending, etc). The Follow-Up
-- Agent Dashboard was built on top of that same RPC for its historical/
-- ownership KPIs (Total Assigned, Treated, Delivered, Saved Orders) — which
-- means those numbers could silently SHRINK the moment an order resolves and
-- drops out of the queue, even though the agent's real historical work never
-- went away. Confirmed live: MEERAB has 1289 orders permanently assigned to
-- her (orders.follow_up_assigned_to), but only 985 of them currently satisfy
-- get_follow_ups_data()'s eligibility conditions — 304 real orders were
-- invisible to her own dashboard's totals.
--
-- This function is the permanent-ownership counterpart: every order ever
-- assigned to the calling agent, with no eligibility/timing filter at all.
-- Scoped to auth.uid() internally (not a parameter), so it can never leak
-- another agent's portfolio regardless of caller role.
CREATE OR REPLACE FUNCTION public.get_my_follow_up_portfolio()
RETURNS TABLE(order_id text, follow_up_status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    o.order_id,
    COALESCE(fu.follow_up_status, 'pending')
  FROM public.orders o
  LEFT JOIN public.order_follow_ups fu ON fu.order_id = o.order_id
  WHERE o.follow_up_assigned_to = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.get_my_follow_up_portfolio() TO authenticated;
