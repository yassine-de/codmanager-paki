CREATE OR REPLACE FUNCTION public.resolve_duplicate_group(
  p_valid_order_id uuid,
  p_agent_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_phone text;
  v_product text;
BEGIN
  -- Get the phone and product of the valid order
  SELECT customer_phone, product_name INTO v_phone, v_product
  FROM orders
  WHERE id = p_valid_order_id AND agent_id = p_agent_id;

  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'Order not found or not assigned to this agent';
  END IF;

  -- Mark all OTHER orders with same phone+product assigned to this agent as "double"
  UPDATE orders
  SET confirmation_status = 'double',
      note = 'Duplicate of ' || (SELECT order_id FROM orders WHERE id = p_valid_order_id),
      updated_at = now()
  WHERE agent_id = p_agent_id
    AND customer_phone = v_phone
    AND product_name = v_product
    AND id != p_valid_order_id
    AND confirmation_status = 'new';
END;
$function$;