-- Closes the last gap between "Your Ranking" and the dashboard's own
-- "Confirmed" card: an order an agent worked on and moved off "new" that
-- was LATER fully reassigned (neither agent_id nor original_agent_id
-- points back to them anymore) still counts toward that agent's dashboard
-- card via order_history, but was excluded from get_agent_rankings(). Add
-- that same history-touched attribution as a third source, deduplicated so
-- an order counted once per agent even if touched multiple times.
DROP FUNCTION IF EXISTS public.get_agent_rankings(timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.get_agent_rankings(p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL)
RETURNS TABLE(agent_id uuid, agent_name text, confirmed_count bigint, total_count bigint, new_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH history_extra AS (
    SELECT DISTINCT oh.changed_by AS attributed_agent_id, o.id AS order_pk
    FROM public.order_history oh
    JOIN public.orders o ON o.order_id = oh.order_id
    WHERE oh.changed_by IS NOT NULL
      AND o.confirmation_status <> 'new'
      AND o.agent_id IS DISTINCT FROM oh.changed_by
      AND o.original_agent_id IS DISTINCT FROM oh.changed_by
  ),
  attributed AS (
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
    UNION ALL
    SELECT
      he.attributed_agent_id,
      o.confirmation_status,
      COALESCE(
        CASE WHEN o.confirmation_status = 'confirmed' THEN o.confirmed_at END,
        o.last_activity_at, o.last_attempt_at, o.updated_at, o.created_at
      )
    FROM history_extra he
    JOIN public.orders o ON o.id = he.order_pk
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
