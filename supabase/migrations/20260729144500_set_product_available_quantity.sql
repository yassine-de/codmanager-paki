CREATE OR REPLACE FUNCTION public.set_product_available_quantity(
  p_product_id uuid,
  p_available_quantity integer,
  p_reason text DEFAULT 'Manual product edit available quantity'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_variant_id uuid;
  v_variant_count integer;
  v_location_id uuid;
  v_balance_id uuid;
  v_current_quantity integer := 0;
  v_target_quantity integer := 0;
  v_delta integer;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admins can manually set product available quantity';
  END IF;

  IF p_available_quantity IS NULL OR p_available_quantity < 0 THEN
    RAISE EXCEPTION 'Available quantity must be zero or greater';
  END IF;

  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  SELECT COUNT(*), MIN(id)
  INTO v_variant_count, v_variant_id
  FROM public.product_variants
  WHERE product_id = p_product_id
    AND active = true;

  IF v_variant_count = 0 THEN
    INSERT INTO public.product_variants (
      product_id,
      sku,
      name,
      price,
      landed_cost,
      weight_kg
    )
    VALUES (
      p_product_id,
      v_product.sku,
      'Default',
      v_product.price,
      v_product.landed_price,
      v_product.weight_kg
    )
    RETURNING id INTO v_variant_id;
  ELSIF v_variant_count > 1 THEN
    RAISE EXCEPTION 'This product has multiple variants. Adjust each variant from Warehouse Inventory.';
  END IF;

  SELECT id INTO v_location_id
  FROM public.inventory_locations
  WHERE code = 'MAIN'
    AND active = true
  LIMIT 1;

  IF v_location_id IS NULL THEN
    SELECT id INTO v_location_id
    FROM public.inventory_locations
    WHERE type = 'sellable'
      AND active = true
    ORDER BY created_at
    LIMIT 1;
  END IF;

  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'No active sellable inventory location found';
  END IF;

  INSERT INTO public.inventory_balances (
    product_variant_id,
    location_id,
    quantity_on_hand
  )
  VALUES (
    v_variant_id,
    v_location_id,
    0
  )
  ON CONFLICT (product_variant_id, location_id) DO NOTHING;

  SELECT id, quantity_on_hand
  INTO v_balance_id, v_target_quantity
  FROM public.inventory_balances
  WHERE product_variant_id = v_variant_id
    AND location_id = v_location_id
  FOR UPDATE;

  SELECT COALESCE(SUM(ib.quantity_on_hand), 0)::integer
  INTO v_current_quantity
  FROM public.inventory_balances ib
  JOIN public.inventory_locations il ON il.id = ib.location_id
  WHERE ib.product_variant_id = v_variant_id
    AND il.type <> 'damaged';

  v_delta := p_available_quantity - COALESCE(v_current_quantity, 0);

  IF v_target_quantity + v_delta < 0 THEN
    RAISE EXCEPTION 'Adjustment would make MAIN stock negative. Adjust variants/locations from Warehouse Inventory.';
  END IF;

  UPDATE public.inventory_balances
  SET quantity_on_hand = v_target_quantity + v_delta,
      updated_at = now()
  WHERE id = v_balance_id;

  UPDATE public.products
  SET quantity = p_available_quantity,
      updated_at = now()
  WHERE id = p_product_id;

  IF v_delta <> 0 THEN
    INSERT INTO public.inventory_movements (
      product_variant_id,
      movement_type,
      quantity_change,
      from_location_id,
      to_location_id,
      created_by,
      metadata
    )
    VALUES (
      v_variant_id,
      'adjustment'::public.inventory_movement_type,
      v_delta,
      CASE WHEN v_delta < 0 THEN v_location_id ELSE NULL END,
      CASE WHEN v_delta > 0 THEN v_location_id ELSE NULL END,
      auth.uid(),
      jsonb_build_object(
        'reason', COALESCE(NULLIF(trim(p_reason), ''), 'Manual product edit available quantity'),
        'source', 'product_edit_available_quantity',
        'product_id', p_product_id,
        'previous_available_quantity', COALESCE(v_current_quantity, 0),
        'new_available_quantity', p_available_quantity
      )
    );
  END IF;

  RETURN p_available_quantity;
END;
$$;
