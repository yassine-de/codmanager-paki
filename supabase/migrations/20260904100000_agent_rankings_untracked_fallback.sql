-- Follow-up to 20260904090000: that migration made get_agent_rankings()
-- strictly evidence-based (order_history only), which correctly stopped
-- crediting an agent with another agent's confirmed order — but as a side
-- effect, it also dropped orders that were created ALREADY confirmed via a
-- flow that never writes an order_history transition at all (WhatsApp
-- auto-confirm, sheet import, manual-confirmed creation) — those orders
-- simply vanished from every agent's ranking instead of counting for
-- whoever currently/originally owns them, which is the correct call when
-- nobody else has a documented claim on the work either. Restores that
-- fallback — but ONLY for orders with zero confirmation_status history from
-- ANYONE, so the original agent-misattribution bug stays fixed while
-- untracked-but-owned confirmations are counted again. Matches the same
-- fallback used in ConfirmationAnalytics.tsx (agentActionsInPeriod) and
-- AgentDashboard.tsx (otherAgentHistoryByOrder) so all three stay consistent.

CREATE OR REPLACE FUNCTION public.get_agent_rankings(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
RETURNS TABLE(agent_id uuid, agent_name text, confirmed_count bigint, total_count bigint, new_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH history_actions AS (
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
  ),
  any_history_order_ids AS (
    SELECT DISTINCT order_id FROM public.order_history
    WHERE field_changed = 'confirmation_status' AND changed_by IS NOT NULL
  ),
  fallback_actions AS (
    SELECT
      COALESCE(o.agent_id, o.original_agent_id) AS agent_id,
      o.order_id,
      o.confirmation_status AS status,
      COALESCE(
        CASE WHEN o.confirmation_status = 'confirmed' THEN o.confirmed_at END,
        o.last_attempt_at, o.last_activity_at, o.updated_at, o.created_at
      ) AS event_at
    FROM public.orders o
    WHERE o.confirmation_status <> 'new'
      AND COALESCE(o.agent_id, o.original_agent_id) IS NOT NULL
      AND o.order_id NOT IN (SELECT order_id FROM any_history_order_ids)
      AND EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = COALESCE(o.agent_id, o.original_agent_id) AND ur.role = 'agent'
      )
  ),
  combined AS (
    SELECT agent_id, order_id, status, event_at FROM history_actions
    UNION ALL
    SELECT agent_id, order_id, status, event_at FROM fallback_actions
    WHERE (p_from IS NULL OR event_at >= p_from) AND (p_to IS NULL OR event_at <= p_to)
  )
  SELECT
    c.agent_id, p.name,
    count(*) FILTER (WHERE c.status = 'confirmed')::bigint,
    count(*)::bigint,
    0::bigint
  FROM combined c
  JOIN public.profiles p ON p.user_id = c.agent_id
  GROUP BY c.agent_id, p.name
  HAVING count(*) FILTER (WHERE c.status = 'confirmed') > 0
  ORDER BY count(*) FILTER (WHERE c.status = 'confirmed') DESC;
$$;
