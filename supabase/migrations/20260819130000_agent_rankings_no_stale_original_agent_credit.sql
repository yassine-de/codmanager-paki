-- Fixes agent ranking misattribution: the original_agent_id branch
-- credited that agent for ANY activity on the order (via relevant_at)
-- whenever original_agent_id differed from the current agent_id — which
-- includes the extremely common case of a reassigned order, where a
-- DIFFERENT agent is now actively working it and already gets credited
-- via the agent_id branch. Confirmed live: HARRAM (no login since
-- 2026-08-13, zero activity today) showed 9 "confirmed" and 12% today in
-- the ranking, entirely from orders reassigned to sidra hanif — every one
-- of those confirmations was sidra hanif's real work today, double-counted
-- onto HARRAM because original_agent_id is never cleared on reassignment.
--
-- Fix: only fall back to original_agent_id when the order currently has
-- NO active owner (agent_id IS NULL) — i.e. the original agent only gets
-- credit when nobody has since taken over the order. The history_extra
-- branch (crediting a real logged order_history action by an agent whose
-- id isn't in either field) is untouched — that's a genuine event, not a
-- stale field.

CREATE OR REPLACE FUNCTION public.get_agent_rankings(p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL)
RETURNS TABLE(agent_id uuid, agent_name text, confirmed_count bigint, total_count bigint, new_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
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
      AND o.agent_id IS NULL
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
$$;
