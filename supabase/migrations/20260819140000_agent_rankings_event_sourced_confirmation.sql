-- Second pass on agent ranking attribution. The previous fix
-- (20260819130000) stopped crediting a stale original_agent_id when a
-- DIFFERENT current agent owns the order, but two more misattribution
-- paths remained, both because relevant_at/attribution were computed at
-- the ORDER level and then applied to every agent linked to that order,
-- even when that specific agent's real involvement happened at a
-- completely different time:
--
--  1) AB-918: agent_id had gone back to NULL after being claimed/released
--     several times (esha, sidra hanif, then Alishba, who actually
--     confirmed it today). original_agent_id was still HARRAM from her
--     one touch on 2026-08-05. The agent_id-IS-NULL fallback branch
--     credited HARRAM for a confirmation Alishba performed today.
--  2) AB-1545: HARRAM did a real no_answer attempt on 2026-08-12. esha
--     confirmed the order today (2026-08-19). The history_extra branch
--     credited HARRAM using the order's relevant_at (= confirmed_at,
--     today), i.e. HARRAM's real-but-unrelated past action borrowed
--     today's confirmation credit that belongs to esha.
--
-- Fix: for any order that is currently 'confirmed', attribution now comes
-- directly from order_history — specifically the (latest) row where
-- field_changed='confirmation_status' AND new_value='confirmed' — crediting
-- whoever's changed_by actually performed that confirmation, at that row's
-- own created_at. This is ground truth: it's the exact event that produced
-- the outcome being measured, not a snapshot field that can go stale or a
-- historical touch unrelated to the eventual confirmation. Confirmed
-- orders with such a row are attributed ONLY that way (removed from the
-- older agent_id/original_agent_id/history_extra branches, so they can't
-- double-count for a different, wrong agent). Confirmed orders with no
-- matching history row (pre-dates history logging) fall back to the prior
-- heuristic unchanged, so no existing data silently loses attribution.
-- Non-confirmed statuses (total_count contributors) are untouched.

CREATE OR REPLACE FUNCTION public.get_agent_rankings(p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL)
RETURNS TABLE(agent_id uuid, agent_name text, confirmed_count bigint, total_count bigint, new_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH confirmed_events AS (
    SELECT DISTINCT ON (oh.order_id)
      o.id AS order_pk, oh.changed_by AS attributed_agent_id, oh.created_at AS event_at
    FROM public.order_history oh
    JOIN public.orders o ON o.order_id = oh.order_id
    WHERE oh.field_changed = 'confirmation_status'
      AND oh.new_value = 'confirmed'
      AND oh.changed_by IS NOT NULL
      AND oh.changed_by_role = 'agent'
      AND o.confirmation_status = 'confirmed'
      AND EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = oh.changed_by AND ur.role = 'agent'
      )
    ORDER BY oh.order_id, oh.created_at DESC
  ),
  history_extra AS (
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
      ce.attributed_agent_id,
      'confirmed'::text AS confirmation_status,
      ce.event_at AS relevant_at
    FROM confirmed_events ce
    UNION ALL
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
      AND NOT (o.confirmation_status = 'confirmed' AND EXISTS (SELECT 1 FROM confirmed_events ce WHERE ce.order_pk = o.id))
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
      AND NOT (o.confirmation_status = 'confirmed' AND EXISTS (SELECT 1 FROM confirmed_events ce WHERE ce.order_pk = o.id))
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
    WHERE NOT (o.confirmation_status = 'confirmed' AND EXISTS (SELECT 1 FROM confirmed_events ce WHERE ce.order_pk = o.id))
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
