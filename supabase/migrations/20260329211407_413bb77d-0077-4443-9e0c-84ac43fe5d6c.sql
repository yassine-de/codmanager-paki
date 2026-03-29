
-- Add lease tracking columns to orders
ALTER TABLE public.orders 
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

-- Function to release expired order locks (2 min timeout)
CREATE OR REPLACE FUNCTION public.release_expired_order_locks()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE orders
  SET agent_id = NULL, assigned_at = NULL, last_activity_at = NULL
  WHERE agent_id IS NOT NULL
    AND confirmation_status = 'new'
    AND last_activity_at IS NOT NULL
    AND last_activity_at < now() - interval '2 minutes';
$$;

-- Function to touch/heartbeat an order lock
CREATE OR REPLACE FUNCTION public.touch_order_lock(p_order_id uuid, p_agent_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE orders
  SET last_activity_at = now()
  WHERE id = p_order_id
    AND agent_id = p_agent_id;
$$;

-- Function to release a specific order lock
CREATE OR REPLACE FUNCTION public.release_order_lock(p_order_id uuid, p_agent_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE orders
  SET agent_id = NULL, assigned_at = NULL, last_activity_at = NULL
  WHERE id = p_order_id
    AND agent_id = p_agent_id
    AND confirmation_status = 'new';
$$;

-- Update claim_next_order to set lease timestamps and release expired locks first
CREATE OR REPLACE FUNCTION public.claim_next_order(p_agent_id uuid, p_product_names text[] DEFAULT NULL, p_order_type text DEFAULT 'new')
RETURNS SETOF orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Always release expired locks first
  PERFORM release_expired_order_locks();

  IF p_order_type = 'new' THEN
    RETURN QUERY
    WITH picked AS (
      SELECT o.id
      FROM orders o
      WHERE o.confirmation_status = 'new'
        AND o.agent_id IS NULL
        AND (p_product_names IS NULL OR o.product_name = ANY(p_product_names))
      ORDER BY o.created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE orders o2
    SET agent_id = p_agent_id, assigned_at = now(), last_activity_at = now(), updated_at = now()
    FROM picked
    WHERE o2.id = picked.id
    RETURNING o2.*;

  ELSIF p_order_type = 'postponed' THEN
    RETURN QUERY
    WITH picked AS (
      SELECT o.id
      FROM orders o
      WHERE o.confirmation_status = 'postponed'
        AND o.agent_id IS NULL
        AND o.postpone_date <= now()
        AND (p_product_names IS NULL OR o.product_name = ANY(p_product_names))
      ORDER BY o.postpone_date ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE orders o2
    SET agent_id = p_agent_id, assigned_at = now(), last_activity_at = now(), updated_at = now()
    FROM picked
    WHERE o2.id = picked.id
    RETURNING o2.*;

  ELSIF p_order_type = 'no_answer' THEN
    RETURN QUERY
    WITH picked AS (
      SELECT o.id
      FROM orders o
      WHERE o.confirmation_status = 'no_answer'
        AND o.agent_id IS NULL
        AND (p_product_names IS NULL OR o.product_name = ANY(p_product_names))
      ORDER BY o.updated_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE orders o2
    SET agent_id = p_agent_id, assigned_at = now(), last_activity_at = now(), updated_at = now()
    FROM picked
    WHERE o2.id = picked.id
    RETURNING o2.*;

  ELSIF p_order_type = 'duplicate' THEN
    RETURN QUERY
    WITH first_dup AS (
      SELECT o.customer_phone, o.product_name
      FROM orders o
      WHERE o.confirmation_status = 'new'
        AND o.agent_id IS NULL
        AND (p_product_names IS NULL OR o.product_name = ANY(p_product_names))
      GROUP BY o.customer_phone, o.product_name
      HAVING COUNT(*) > 1
      LIMIT 1
    ),
    picked AS (
      SELECT o.id
      FROM orders o
      INNER JOIN first_dup fd ON o.customer_phone = fd.customer_phone AND o.product_name = fd.product_name
      WHERE o.confirmation_status = 'new'
        AND o.agent_id IS NULL
      FOR UPDATE SKIP LOCKED
    )
    UPDATE orders o2
    SET agent_id = p_agent_id, assigned_at = now(), last_activity_at = now(), updated_at = now()
    FROM picked
    WHERE o2.id = picked.id
    RETURNING o2.*;
  END IF;
END;
$function$;
