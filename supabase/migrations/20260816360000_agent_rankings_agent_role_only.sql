-- Fixes a bug in the previous migration's history_extra addition: it
-- attributed an order to WHOEVER touched it in order_history, with no role
-- filter. That pulled non-agent actors (admin edits, warehouse actions,
-- system/cron writes using the all-zero sentinel changed_by, even a
-- Warehouse Manager account) into what is supposed to be a confirmation
-- agent leaderboard. Restrict history_extra to changed_by_role='agent' at
-- the source, and additionally require the final attributed_agent_id to
-- currently hold the 'agent' role — belt-and-suspenders in case agent_id/
-- original_agent_id on an order was ever set to a non-agent user.
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
      AND oh.changed_by_role = 'agent'
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
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = a.attributed_agent_id AND ur.role = 'agent'
    )
  GROUP BY a.attributed_agent_id, p.name
  HAVING count(*) FILTER (WHERE a.confirmation_status = 'confirmed') > 0
  ORDER BY count(*) FILTER (WHERE a.confirmation_status = 'confirmed') DESC;
$function$;
