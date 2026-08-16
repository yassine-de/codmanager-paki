-- get_agent_rankings() was all-time with agent_id-only attribution, while
-- the dashboard's own stat cards are scoped to the selected date range and
-- attribute an order to BOTH its current agent_id and its original_agent_id
-- (an order keeps counting for the agent who originally worked it even
-- after being reclaimed by someone else on retry). This mismatch made
-- "Your Ranking" silently disagree with the "Confirmed" card for the same
-- agent on the same page. Add date params and the same OR-attribution so
-- both numbers are computed the same way.
--
-- Simplification versus the dashboard's own client-side calculation: this
-- does not additionally pull in orders only touched via order_history (an
-- order fully reassigned away from an agent, with neither agent_id nor
-- original_agent_id pointing back to them, won't count here). That's a
-- rarer edge case; the primary discrepancy being fixed is the time-window
-- and attribution mismatch, not that history-only case.
DROP FUNCTION IF EXISTS public.get_agent_rankings();

CREATE OR REPLACE FUNCTION public.get_agent_rankings(p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL)
RETURNS TABLE(agent_id uuid, agent_name text, confirmed_count bigint, total_count bigint, new_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH attributed AS (
    SELECT
      o.agent_id AS attributed_agent_id,
      o.confirmation_status,
      COALESCE(
        CASE WHEN o.confirmation_status = 'confirmed' THEN o.confirmed_at END,
        o.last_activity_at, o.last_attempt_at, o.updated_at, o.created_at
      ) AS relevant_at
    FROM public.orders o
    WHERE o.agent_id IS NOT NULL
      AND o.confirmation_status <> 'new'
    UNION ALL
    SELECT
      o.original_agent_id,
      o.confirmation_status,
      COALESCE(
        CASE WHEN o.confirmation_status = 'confirmed' THEN o.confirmed_at END,
        o.last_activity_at, o.last_attempt_at, o.updated_at, o.created_at
      )
    FROM public.orders o
    WHERE o.original_agent_id IS NOT NULL
      AND o.original_agent_id IS DISTINCT FROM o.agent_id
      AND o.confirmation_status <> 'new'
  )
  SELECT a.attributed_agent_id, p.name,
    count(*) FILTER (WHERE a.confirmation_status = 'confirmed')::bigint,
    count(*)::bigint,
    0::bigint
  FROM attributed a
  LEFT JOIN public.profiles p ON p.user_id = a.attributed_agent_id
  WHERE (p_from IS NULL OR a.relevant_at >= p_from)
    AND (p_to IS NULL OR a.relevant_at <= p_to)
  GROUP BY a.attributed_agent_id, p.name
  HAVING count(*) FILTER (WHERE a.confirmation_status = 'confirmed') > 0
  ORDER BY count(*) FILTER (WHERE a.confirmation_status = 'confirmed') DESC;
$function$;
