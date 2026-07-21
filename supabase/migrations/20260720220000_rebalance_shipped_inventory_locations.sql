CREATE OR REPLACE FUNCTION public.apply_inventory_ship_for_order(
  p_order_uuid uuid,
  p_created_by uuid DEFAULT auth.uid()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_fallback_location uuid;
  v_source_location uuid;
  v_shipment_id uuid;
  v_item record;
  v_applied integer := 0;
BEGIN
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_uuid;

  IF NOT FOUND OR COALESCE(v_order.delivery_status, '') NOT IN (
    'shipped',
    'in_transit',
    'with_courier',
    'out_for_delivery',
    'delivered',
    'paid',
    'failed_attempt',
    'ready_for_return',
    'return',
    'returned',
    'return_received'
  ) THEN
    RETURN 0;
  END IF;

  SELECT il.id INTO v_fallback_location
  FROM public.inventory_locations il
  WHERE il.code = 'MAIN'
  LIMIT 1;

  IF v_fallback_location IS NULL THEN
    RAISE EXCEPTION 'Inventory location MAIN is missing';
  END IF;

  SELECT s.id INTO v_shipment_id
  FROM public.shipments s
  WHERE s.order_uuid = p_order_uuid
  ORDER BY s.created_at DESC
  LIMIT 1;

  FOR v_item IN
    SELECT oi.product_variant_id, sum(oi.quantity)::integer AS quantity
    FROM public.order_items oi
    WHERE oi.order_id = p_order_uuid
      AND oi.product_variant_id IS NOT NULL
    GROUP BY oi.product_variant_id
  LOOP
    IF EXISTS (
      SELECT 1
      FROM public.inventory_movements im
      WHERE im.order_uuid = p_order_uuid
        AND im.product_variant_id = v_item.product_variant_id
        AND im.movement_type = 'ship'
    ) THEN
      CONTINUE;
    END IF;

    SELECT ib.location_id INTO v_source_location
    FROM public.inventory_balances ib
    JOIN public.inventory_locations il ON il.id = ib.location_id
    WHERE ib.product_variant_id = v_item.product_variant_id
      AND ib.quantity_on_hand > 0
      AND il.code NOT IN ('DAMAGED', 'RETURNS')
    ORDER BY
      CASE il.code WHEN 'MAIN' THEN 0 WHEN 'UNASSIGNED' THEN 1 ELSE 2 END,
      ib.quantity_on_hand DESC,
      ib.updated_at ASC
    LIMIT 1;

    v_source_location := COALESCE(v_source_location, v_fallback_location);

    INSERT INTO public.inventory_movements (
      product_variant_id,
      order_uuid,
      order_id,
      shipment_id,
      movement_type,
      quantity_change,
      from_location_id,
      created_by,
      metadata
    )
    VALUES (
      v_item.product_variant_id,
      p_order_uuid,
      v_order.order_id,
      v_shipment_id,
      'ship',
      -v_item.quantity,
      v_source_location,
      p_created_by,
      jsonb_build_object('reason', 'order_entered_delivery_pool', 'delivery_status', v_order.delivery_status)
    );

    INSERT INTO public.inventory_balances (product_variant_id, location_id, quantity_on_hand)
    VALUES (v_item.product_variant_id, v_source_location, -v_item.quantity)
    ON CONFLICT (product_variant_id, location_id)
    DO UPDATE SET
      quantity_on_hand = public.inventory_balances.quantity_on_hand - v_item.quantity,
      updated_at = now();

    v_applied := v_applied + v_item.quantity;
  END LOOP;

  RETURN v_applied;
END;
$$;

DO $$
DECLARE
  v_negative record;
  v_cover record;
  v_deficit integer;
BEGIN
  FOR v_negative IN
    SELECT ib.product_variant_id, ib.location_id, ib.quantity_on_hand
    FROM public.inventory_balances ib
    JOIN public.inventory_locations il ON il.id = ib.location_id
    WHERE ib.quantity_on_hand < 0
      AND il.code NOT IN ('DAMAGED', 'RETURNS')
  LOOP
    v_deficit := -v_negative.quantity_on_hand;

    SELECT ib.location_id, ib.quantity_on_hand INTO v_cover
    FROM public.inventory_balances ib
    JOIN public.inventory_locations il ON il.id = ib.location_id
    WHERE ib.product_variant_id = v_negative.product_variant_id
      AND ib.location_id <> v_negative.location_id
      AND ib.quantity_on_hand >= v_deficit
      AND il.code NOT IN ('DAMAGED', 'RETURNS')
    ORDER BY
      CASE il.code WHEN 'MAIN' THEN 0 WHEN 'UNASSIGNED' THEN 1 ELSE 2 END,
      ib.quantity_on_hand DESC
    LIMIT 1;

    IF FOUND THEN
      UPDATE public.inventory_balances
      SET quantity_on_hand = quantity_on_hand - v_deficit,
          updated_at = now()
      WHERE product_variant_id = v_negative.product_variant_id
        AND location_id = v_cover.location_id;

      UPDATE public.inventory_balances
      SET quantity_on_hand = 0,
          updated_at = now()
      WHERE product_variant_id = v_negative.product_variant_id
        AND location_id = v_negative.location_id;

      UPDATE public.inventory_movements
      SET from_location_id = v_cover.location_id,
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
            'source_location_rebalanced', true,
            'rebalanced_at', now()
          )
      WHERE product_variant_id = v_negative.product_variant_id
        AND movement_type = 'ship'
        AND from_location_id = v_negative.location_id
        AND COALESCE(metadata ->> 'reason', '') = 'order_entered_delivery_pool';
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
