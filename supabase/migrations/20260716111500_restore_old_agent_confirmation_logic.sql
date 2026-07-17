-- Restore the old call-center confirmation flow:
-- - WhatsApp orders switch back to the agent queue after the configured timeout.
-- - Agents claim duplicate, postponed, new, and no-answer orders with the old priorities.
-- - Duplicate groups are resolved by normalized phone + product.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS agent_switch_scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS agent_switched_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_orders_agent_switch_scheduled
  ON public.orders (agent_switch_scheduled_at)
  WHERE agent_switch_scheduled_at IS NOT NULL
    AND confirmation_status = 'new_wts';

CREATE OR REPLACE FUNCTION public.process_agent_switch_timeouts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH eligible AS (
    SELECT o.order_id
    FROM public.orders o
    LEFT JOIN public.whatsapp_conversations c
      ON c.order_id = o.order_id
    WHERE o.confirmation_status = 'new_wts'
      AND o.agent_switch_scheduled_at IS NOT NULL
      AND o.agent_switch_scheduled_at <= now()
      AND o.agent_switched_at IS NULL
      AND (c.id IS NULL OR c.last_reply_at IS NULL)
  ), updated AS (
    UPDATE public.orders o
       SET confirmation_status = 'new',
           confirmation_channel = 'agent',
           agent_id = NULL,
           assigned_at = NULL,
           last_activity_at = NULL,
           agent_switched_at = now(),
           updated_at = now()
      FROM eligible e
     WHERE o.order_id = e.order_id
     RETURNING o.order_id
  )
  SELECT count(*) INTO v_count FROM updated;

  RETURN v_count;
END;
$$;

DROP FUNCTION IF EXISTS public.claim_next_order(uuid, text, text[]);

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
    )
    UPDATE public.orders o2
    SET agent_id = p_agent_id,
        assigned_at = now(),
        last_activity_at = now(),
        updated_at = now()
    FROM picked
    WHERE o2.id = picked.id
    RETURNING o2.*;

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
    )
    UPDATE public.orders o2
    SET agent_id = p_agent_id,
        assigned_at = now(),
        last_activity_at = now(),
        updated_at = now()
    FROM picked
    WHERE o2.id = picked.id
    RETURNING o2.*;

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
    )
    UPDATE public.orders o2
    SET agent_id = p_agent_id,
        assigned_at = now(),
        last_activity_at = now(),
        updated_at = now()
    FROM picked
    WHERE o2.id = picked.id
    RETURNING o2.*;

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
      )
      UPDATE public.orders o2
      SET agent_id = p_agent_id,
          assigned_at = now(),
          last_activity_at = now(),
          updated_at = now()
      FROM picked
      WHERE o2.id = picked.id
      RETURNING o2.*;
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
    )
    UPDATE public.orders o2
    SET agent_id = p_agent_id,
        assigned_at = now(),
        last_activity_at = now(),
        updated_at = now()
    FROM picked
    WHERE o2.id = picked.id
    RETURNING o2.*;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_duplicate_group(
  p_valid_order_id uuid,
  p_agent_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
  v_product text;
BEGIN
  SELECT customer_phone, product_name
  INTO v_phone, v_product
  FROM public.orders
  WHERE id = p_valid_order_id
    AND agent_id = p_agent_id;

  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'Order not found or not assigned to this agent';
  END IF;

  UPDATE public.orders
  SET confirmation_status = 'double',
      note = 'Duplicate of ' || (SELECT order_id FROM public.orders WHERE id = p_valid_order_id),
      updated_at = now()
  WHERE agent_id = p_agent_id
    AND public.normalize_phone_key(customer_phone) = public.normalize_phone_key(v_phone)
    AND product_name = v_product
    AND id <> p_valid_order_id
    AND confirmation_status = 'new';
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_agent_switch_timeouts() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_next_order(uuid, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_duplicate_group(uuid, uuid) TO authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-agent-switch-timeouts') THEN
    PERFORM cron.unschedule('process-agent-switch-timeouts');
  END IF;

  PERFORM cron.schedule(
    'process-agent-switch-timeouts',
    '* * * * *',
    $cron$ SELECT public.process_agent_switch_timeouts(); $cron$
  );
END $$;

NOTIFY pgrst, 'reload schema';
