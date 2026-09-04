-- get_agent_rankings() had the same misattribution bug just fixed on the
-- client side (ConfirmationAnalytics.tsx / AgentDashboard.tsx): for any
-- confirmation_status OTHER than 'confirmed', it fell back to crediting
-- whoever currently/originally owns the order (o.agent_id / o.original_agent_id)
-- rather than whoever actually took that action. Worked example: order created,
-- agent A claims it and marks it No Answer, releases it back to the pool,
-- agent B later claims it and confirms it. original_agent_id stays A (set once,
-- never changes) and agent_id becomes B. In the old function: A is neither
-- o.agent_id (=B) nor does she qualify for the original_agent_id branch (that
-- branch requires o.agent_id IS NULL, which is false once B claimed it), and
-- history_extra explicitly excludes her too (it requires original_agent_id BE
-- DIFFERENT from the agent, which is false for A since she IS the original).
-- Net result: A's real No Answer work is invisible in the rankings entirely —
-- confirmed here live: old function returned lower total_count for every
-- agent than a direct count of their own order_history actions.
--
-- Rebuilt on the same clean model as the frontend fix: one row per
-- (agent, order) — that agent's own LATEST confirmation_status action on that
-- order, independent of who currently/originally owns it or what any other
-- agent did to it afterward. The same order legitimately produces one row per
-- agent who touched it, so agent A keeps her No Answer credit and agent B
-- gets the Confirmed credit, both correctly, simultaneously.

CREATE OR REPLACE FUNCTION public.get_agent_rankings(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
RETURNS TABLE(agent_id uuid, agent_name text, confirmed_count bigint, total_count bigint, new_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_actions AS (
    SELECT DISTINCT ON (oh.changed_by, oh.order_id)
      oh.changed_by AS agent_id,
      oh.order_id,
      oh.new_value AS status,
      oh.created_at AS event_at
    FROM public.order_history oh
    WHERE oh.field_changed = 'confirmation_status'
      AND oh.new_value IS NOT NULL
      AND oh.new_value <> 'new'
      AND oh.changed_by IS NOT NULL
      AND oh.changed_by_role = 'agent'
      AND (p_from IS NULL OR oh.created_at >= p_from)
      AND (p_to IS NULL OR oh.created_at <= p_to)
    ORDER BY oh.changed_by, oh.order_id, oh.created_at DESC
  )
  SELECT
    la.agent_id,
    p.name,
    count(*) FILTER (WHERE la.status = 'confirmed')::bigint AS confirmed_count,
    count(*)::bigint AS total_count,
    0::bigint AS new_count
  FROM latest_actions la
  JOIN public.profiles p ON p.user_id = la.agent_id
  WHERE EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = la.agent_id AND ur.role = 'agent')
  GROUP BY la.agent_id, p.name
  HAVING count(*) FILTER (WHERE la.status = 'confirmed') > 0
  ORDER BY count(*) FILTER (WHERE la.status = 'confirmed') DESC;
$$;
