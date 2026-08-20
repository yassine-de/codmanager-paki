-- Third pass. The event-sourced fix (20260819140000) only recognized a
-- confirming event when changed_by_role='agent', so it correctly ignored
-- AI-confirmed orders (WhatsApp auto-confirm flow: order_history row with
-- changed_by = '00000000-0000-0000-0000-000000000000', changed_by_role='ai',
-- action_type='ai_confirm'). But the exclusion that stops orders from
-- falling back to the old agent_id/original_agent_id/history_extra
-- heuristic was ALSO scoped to "has an agent-authored confirming event" —
-- so an AI-confirmed order (agent_id/original_agent_id both NULL, since no
-- human ever claimed it) fell through to history_extra and got credited
-- to whichever agent happened to touch ANY other field on it afterward
-- (e.g. booking the delivery_status for shipping) — crediting a
-- "confirmed" that was never actually performed by that agent.
--
-- Confirmed live: esha's "confirmed today" included 9 such orders
-- (AB-2036, AB-2039, AB-2050, AB-2053, AB-2054, HG-13, SU-365, SU-366,
-- SU-367) — all confirmed by the AI flow; esha's only real touch was
-- setting delivery_status to 'booked' afterward, unrelated to confirming.
--
-- Fix: broaden the fallback-exclusion check from "has an agent-authored
-- confirming event" to "has ANY logged confirming event, by anyone/anything"
-- (agent or ai). If the confirmation is traceable at all, only that
-- traced source can get credit (and only if it's a real agent, via
-- confirmed_events) — nobody else gets fallback credit for a confirmation
-- they didn't perform. Orders with NO logged confirming event whatsoever
-- (fully untraceable legacy data) still fall back to the old heuristic
-- exactly as before, so no genuinely undocumented order loses attribution.

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
  any_confirm_event AS (
    SELECT DISTINCT o.id AS order_pk
    FROM public.order_history oh
    JOIN public.orders o ON o.order_id = oh.order_id
    WHERE oh.field_changed = 'confirmation_status'
      AND oh.new_value = 'confirmed'
      AND o.confirmation_status = 'confirmed'
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
      AND NOT (o.confirmation_status = 'confirmed' AND EXISTS (SELECT 1 FROM any_confirm_event ace WHERE ace.order_pk = o.id))
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
      AND NOT (o.confirmation_status = 'confirmed' AND EXISTS (SELECT 1 FROM any_confirm_event ace WHERE ace.order_pk = o.id))
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
    WHERE NOT (o.confirmation_status = 'confirmed' AND EXISTS (SELECT 1 FROM any_confirm_event ace WHERE ace.order_pk = o.id))
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
