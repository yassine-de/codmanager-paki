CREATE OR REPLACE FUNCTION public.claim_next_order(p_agent_id uuid, p_product_names text[] DEFAULT NULL::text[], p_order_type text DEFAULT 'new'::text)
 RETURNS SETOF orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
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
        AND o.original_agent_id = p_agent_id
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
        AND o.original_agent_id = p_agent_id
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