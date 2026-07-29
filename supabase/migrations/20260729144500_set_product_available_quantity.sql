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
  v_current_quantity integer := 0;
  v_delta integer;
  v_remaining_reduction integer;
  v_reduce_quantity integer;
  v_balance record;
BEGIN
  IF NOT (
    public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.user_permissions up
      WHERE up.user_id = auth.uid()
        AND up.permission_key = 'manage_inventory'
    )
  ) THEN
    RAISE EXCEPTION 'Only admins or inventory managers can manually set product available quantity';
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

  SELECT COUNT(*), MIN(id::text)::uuid
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

  SELECT COALESCE(SUM(ib.quantity_on_hand), 0)::integer
  INTO v_current_quantity
  FROM public.inventory_balances ib
  JOIN public.inventory_locations il ON il.id = ib.location_id
  WHERE ib.product_variant_id = v_variant_id
    AND il.type <> 'damaged';

  v_delta := p_available_quantity - COALESCE(v_current_quantity, 0);

  IF v_delta > 0 THEN
    UPDATE public.inventory_balances
    SET quantity_on_hand = quantity_on_hand + v_delta,
        updated_at = now()
    WHERE product_variant_id = v_variant_id
      AND location_id = v_location_id;

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
      NULL,
      v_location_id,
      auth.uid(),
      jsonb_build_object(
        'reason', COALESCE(NULLIF(trim(p_reason), ''), 'Manual product edit available quantity'),
        'source', 'product_edit_available_quantity',
        'product_id', p_product_id,
        'previous_available_quantity', COALESCE(v_current_quantity, 0),
        'new_available_quantity', p_available_quantity
      )
    );
  ELSIF v_delta < 0 THEN
    v_remaining_reduction := ABS(v_delta);

    FOR v_balance IN
      SELECT ib.id, ib.location_id, ib.quantity_on_hand
      FROM public.inventory_balances ib
      JOIN public.inventory_locations il ON il.id = ib.location_id
      WHERE ib.product_variant_id = v_variant_id
        AND il.type <> 'damaged'
        AND ib.quantity_on_hand > 0
      ORDER BY
        CASE WHEN il.code = 'MAIN' THEN 0 ELSE 1 END,
        ib.quantity_on_hand DESC,
        ib.updated_at DESC
      FOR UPDATE OF ib
    LOOP
      EXIT WHEN v_remaining_reduction <= 0;
      v_reduce_quantity := LEAST(v_remaining_reduction, v_balance.quantity_on_hand);

      UPDATE public.inventory_balances
      SET quantity_on_hand = quantity_on_hand - v_reduce_quantity,
          updated_at = now()
      WHERE id = v_balance.id;

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
        -v_reduce_quantity,
        v_balance.location_id,
        NULL,
        auth.uid(),
        jsonb_build_object(
          'reason', COALESCE(NULLIF(trim(p_reason), ''), 'Manual product edit available quantity'),
          'source', 'product_edit_available_quantity',
          'product_id', p_product_id,
          'previous_available_quantity', COALESCE(v_current_quantity, 0),
          'new_available_quantity', p_available_quantity
        )
      );

      v_remaining_reduction := v_remaining_reduction - v_reduce_quantity;
    END LOOP;

    IF v_remaining_reduction > 0 THEN
      RAISE EXCEPTION 'Adjustment would make available stock negative';
    END IF;
  END IF;

  UPDATE public.products
  SET quantity = p_available_quantity,
      updated_at = now()
  WHERE id = p_product_id;

  RETURN p_available_quantity;
END;
$$;
