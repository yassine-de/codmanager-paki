-- Harden agent claim locks:
-- - remove old unsafe one-argument lock RPC overloads
-- - increase stale lock expiry from 6 minutes to 15 minutes
-- - write claim/release/expiry events to order_history for auditing

DROP FUNCTION IF EXISTS public.release_order_lock(uuid);
DROP FUNCTION IF EXISTS public.touch_order_lock(uuid);

CREATE OR REPLACE FUNCTION public.release_expired_order_locks()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  WITH stale AS (
    SELECT id, order_id, agent_id
    FROM public.orders
    WHERE agent_id IS NOT NULL
      AND confirmation_status IN ('new', 'no_answer', 'postponed')
      AND COALESCE(last_activity_at, assigned_at) IS NOT NULL
      AND COALESCE(last_activity_at, assigned_at) < now() - interval '15 minutes'
    FOR UPDATE SKIP LOCKED
  ), expired AS (
    UPDATE public.orders
    SET agent_id = NULL,
        assigned_at = NULL,
        last_activity_at = NULL,
        updated_at = now()
    FROM stale
    WHERE orders.id = stale.id
    RETURNING stale.order_id, stale.agent_id
  )
  INSERT INTO public.order_history (
    order_id,
    changed_by,
    changed_by_role,
    field_changed,
    old_value,
    new_value,
    action_type
  )
  SELECT
    order_id,
    COALESCE(agent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    'system',
    'agent_lock',
    agent_id::text,
    NULL,
    'lock_expired'
  FROM expired;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_order_lock(p_order_id uuid, p_agent_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.orders
  SET last_activity_at = now(),
      updated_at = now()
  WHERE id = p_order_id
    AND agent_id = p_agent_id;
$$;

CREATE OR REPLACE FUNCTION public.release_order_lock(p_order_id uuid, p_agent_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  WITH locked AS (
    SELECT id, order_id, agent_id
    FROM public.orders
    WHERE id = p_order_id
      AND agent_id = p_agent_id
      AND confirmation_status IN ('new', 'no_answer', 'postponed')
    FOR UPDATE
  ), released AS (
    UPDATE public.orders
    SET agent_id = NULL,
        assigned_at = NULL,
        last_activity_at = NULL,
        updated_at = now()
    FROM locked
    WHERE orders.id = locked.id
    RETURNING locked.order_id, locked.agent_id
  )
  INSERT INTO public.order_history (
    order_id,
    changed_by,
    changed_by_role,
    field_changed,
    old_value,
    new_value,
    action_type
  )
  SELECT
    order_id,
    p_agent_id,
    'agent',
    'agent_lock',
    agent_id::text,
    NULL,
    'lock_released'
  FROM released;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_next_order(
  p_agent_id uuid,
  p_order_type text DEFAULT 'new',
  p_product_names text[] DEFAULT NULL
)
RETURNS SETOF public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.release_expired_order_locks();

  IF p_order_type = 'new' THEN
    RETURN QUERY
    WITH picked AS (
      SELECT o.id
      FROM public.orders o
      WHERE o.confirmation_status = 'new'
        AND o.agent_id IS NULL
        AND (p_product_names IS NULL OR o.product_name = ANY(p_product_names))
      ORDER BY o.created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    ), claimed AS (
      UPDATE public.orders o2
      SET agent_id = p_agent_id,
          assigned_at = now(),
          last_activity_at = now(),
          updated_at = now()
      FROM picked
      WHERE o2.id = picked.id
      RETURNING o2.*
    ), logged AS (
      INSERT INTO public.order_history (
        order_id, changed_by, changed_by_role, field_changed,
        old_value, new_value, action_type
      )
      SELECT order_id, p_agent_id, 'agent', 'agent_lock',
             NULL, p_agent_id::text, 'order_claimed'
      FROM claimed
      RETURNING 1
    )
    SELECT claimed.* FROM claimed;

  ELSIF p_order_type = 'no_answer' THEN
    RETURN QUERY
    WITH picked AS (
      SELECT o.id
      FROM public.orders o
      WHERE o.confirmation_status = 'no_answer'
        AND o.agent_id IS NULL
        AND o.attempt_count < 12
        AND (o.last_attempt_at IS NULL OR o.last_attempt_at <= now() - interval '30 minutes')
        AND (
          o.last_attempt_date IS DISTINCT FROM CURRENT_DATE
          OR o.attempts_today < 4
        )
        AND (p_product_names IS NULL OR o.product_name = ANY(p_product_names))
      ORDER BY o.last_attempt_at ASC NULLS FIRST
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    ), claimed AS (
      UPDATE public.orders o2
      SET agent_id = p_agent_id,
          assigned_at = now(),
          last_activity_at = now(),
          updated_at = now()
      FROM picked
      WHERE o2.id = picked.id
      RETURNING o2.*
    ), logged AS (
      INSERT INTO public.order_history (
        order_id, changed_by, changed_by_role, field_changed,
        old_value, new_value, action_type
      )
      SELECT order_id, p_agent_id, 'agent', 'agent_lock',
             NULL, p_agent_id::text, 'order_claimed'
      FROM claimed
      RETURNING 1
    )
    SELECT claimed.* FROM claimed;

  ELSIF p_order_type = 'postponed' THEN
    RETURN QUERY
    WITH picked AS (
      SELECT o.id
      FROM public.orders o
      WHERE o.confirmation_status = 'postponed'
        AND o.agent_id IS NULL
        AND o.postpone_date <= now()
        AND o.original_agent_id = p_agent_id
        AND (p_product_names IS NULL OR o.product_name = ANY(p_product_names))
      ORDER BY o.postpone_date ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    ), claimed AS (
      UPDATE public.orders o2
      SET agent_id = p_agent_id,
          assigned_at = now(),
          last_activity_at = now(),
          updated_at = now()
      FROM picked
      WHERE o2.id = picked.id
      RETURNING o2.*
    ), logged AS (
      INSERT INTO public.order_history (
        order_id, changed_by, changed_by_role, field_changed,
        old_value, new_value, action_type
      )
      SELECT order_id, p_agent_id, 'agent', 'agent_lock',
             NULL, p_agent_id::text, 'order_claimed'
      FROM claimed
      RETURNING 1
    )
    SELECT claimed.* FROM claimed;

    IF NOT FOUND THEN
      RETURN QUERY
      WITH picked AS (
        SELECT o.id
        FROM public.orders o
        WHERE o.confirmation_status = 'postponed'
          AND o.agent_id IS NULL
          AND o.postpone_date <= now()
          AND o.original_agent_id IS DISTINCT FROM p_agent_id
          AND NOT EXISTS (
            SELECT 1
            FROM public.user_presence up
            WHERE up.user_id = o.original_agent_id
              AND up.is_active = true
              AND up.last_seen > now() - interval '10 minutes'
          )
          AND (p_product_names IS NULL OR o.product_name = ANY(p_product_names))
        ORDER BY o.postpone_date ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      ), claimed AS (
        UPDATE public.orders o2
        SET agent_id = p_agent_id,
            assigned_at = now(),
            last_activity_at = now(),
            updated_at = now()
        FROM picked
        WHERE o2.id = picked.id
        RETURNING o2.*
      ), logged AS (
        INSERT INTO public.order_history (
          order_id, changed_by, changed_by_role, field_changed,
          old_value, new_value, action_type
        )
        SELECT order_id, p_agent_id, 'agent', 'agent_lock',
               NULL, p_agent_id::text, 'order_claimed'
        FROM claimed
        RETURNING 1
      )
      SELECT claimed.* FROM claimed;
    END IF;

  ELSIF p_order_type = 'duplicate' THEN
    RETURN QUERY
    WITH first_dup AS (
      SELECT public.normalize_phone_key(o.customer_phone) AS phone_key, o.product_name
      FROM public.orders o
      WHERE o.confirmation_status = 'new'
        AND o.agent_id IS NULL
        AND (p_product_names IS NULL OR o.product_name = ANY(p_product_names))
      GROUP BY public.normalize_phone_key(o.customer_phone), o.product_name
      HAVING COUNT(*) > 1
      LIMIT 1
    ), picked AS (
      SELECT o.id
      FROM public.orders o
      INNER JOIN first_dup fd
        ON public.normalize_phone_key(o.customer_phone) = fd.phone_key
       AND o.product_name = fd.product_name
      WHERE o.confirmation_status = 'new'
        AND o.agent_id IS NULL
      FOR UPDATE SKIP LOCKED
    ), claimed AS (
      UPDATE public.orders o2
      SET agent_id = p_agent_id,
          assigned_at = now(),
          last_activity_at = now(),
          updated_at = now()
      FROM picked
      WHERE o2.id = picked.id
      RETURNING o2.*
    ), logged AS (
      INSERT INTO public.order_history (
        order_id, changed_by, changed_by_role, field_changed,
        old_value, new_value, action_type
      )
      SELECT order_id, p_agent_id, 'agent', 'agent_lock',
             NULL, p_agent_id::text, 'order_claimed'
      FROM claimed
      RETURNING 1
    )
    SELECT claimed.* FROM claimed;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_expired_order_locks() TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_order_lock(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_order_lock(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_order(uuid, text, text[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
