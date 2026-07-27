CREATE OR REPLACE FUNCTION public.create_manual_order_with_items(
  p_order jsonb,
  p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_uuid uuid;
  v_item_count integer;
  v_seller_id uuid;
  v_actor uuid;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_seller_id := (p_order ->> 'seller_id')::uuid;
  IF v_seller_id IS NULL THEN
    RAISE EXCEPTION 'seller_id is required';
  END IF;

  IF NOT public.is_staff(v_actor) AND v_seller_id <> v_actor THEN
    RAISE EXCEPTION 'Not allowed to create orders for this seller';
  END IF;

  v_item_count := jsonb_array_length(COALESCE(p_items, '[]'::jsonb));
  IF v_item_count < 1 THEN
    RAISE EXCEPTION 'An order must contain at least one item';
  END IF;

  INSERT INTO public.orders (
    order_id,
    seller_id,
    customer_name,
    customer_phone,
    customer_address,
    customer_city,
    product_name,
    product_url,
    video_url,
    quantity,
    price,
    total_amount,
    weight,
    note,
    confirmation_status,
    confirmation_channel,
    whatsapp_status
  )
  VALUES (
    p_order ->> 'order_id',
    v_seller_id,
    p_order ->> 'customer_name',
    p_order ->> 'customer_phone',
    NULLIF(p_order ->> 'customer_address', ''),
    p_order ->> 'customer_city',
    p_order ->> 'product_name',
    NULLIF(p_order ->> 'product_url', ''),
    NULLIF(p_order ->> 'video_url', ''),
    GREATEST(COALESCE((p_order ->> 'quantity')::integer, 1), 1),
    COALESCE((p_order ->> 'price')::numeric, 0),
    COALESCE((p_order ->> 'total_amount')::numeric, 0),
    COALESCE((p_order ->> 'weight')::numeric, 0),
    NULLIF(p_order ->> 'note', ''),
    p_order ->> 'confirmation_status',
    p_order ->> 'confirmation_channel',
    NULLIF(p_order ->> 'whatsapp_status', '')
  )
  RETURNING id INTO v_order_uuid;

  -- The inventory sync trigger may auto-create a single item from the order row.
  -- Replace it with the exact manual item list selected in the UI.
  DELETE FROM public.order_items WHERE order_id = v_order_uuid;

  INSERT INTO public.order_items (
    order_id,
    product_id,
    product_variant_id,
    sku,
    product_name,
    variant_name,
    quantity,
    unit_price,
    weight_kg,
    metadata
  )
  SELECT
    v_order_uuid,
    item.product_id,
    item.product_variant_id,
    item.sku,
    item.product_name,
    item.variant_name,
    GREATEST(item.quantity, 1),
    item.unit_price,
    item.weight_kg,
    COALESCE(item.metadata, '{}'::jsonb) || jsonb_build_object('source', 'manual_order')
  FROM jsonb_to_recordset(p_items) AS item(
    product_id uuid,
    product_variant_id uuid,
    sku text,
    product_name text,
    variant_name text,
    quantity integer,
    unit_price numeric,
    weight_kg numeric,
    metadata jsonb
  );

  IF (SELECT count(*) FROM public.order_items WHERE order_id = v_order_uuid) <> v_item_count THEN
    RAISE EXCEPTION 'Failed to create every order item';
  END IF;

  INSERT INTO public.order_history (
    order_id,
    changed_by,
    changed_by_role,
    field_changed,
    old_value,
    new_value,
    action_type
  )
  VALUES (
    p_order ->> 'order_id',
    v_actor,
    CASE WHEN public.is_staff(v_actor) THEN 'admin' ELSE 'seller' END,
    'order',
    NULL,
    'created',
    'manual_create'
  );

  RETURN v_order_uuid;
END;
$$;

REVOKE ALL ON FUNCTION public.create_manual_order_with_items(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_manual_order_with_items(jsonb, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
