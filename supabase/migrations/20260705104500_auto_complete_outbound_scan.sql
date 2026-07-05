CREATE OR REPLACE FUNCTION public.scan_outbound_shipment(
  p_tracking_number text,
  p_scanned_by uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shipment public.shipments%ROWTYPE;
  v_scan_id uuid;
  v_main_location uuid;
  v_existing integer;
  v_item record;
BEGIN
  SELECT * INTO v_shipment
  FROM public.shipments
  WHERE tracking_number = p_tracking_number
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.scan_events (tracking_number, scan_type, result, message, scanned_by)
    VALUES (p_tracking_number, 'outbound', 'unknown', 'Unknown tracking number', p_scanned_by)
    RETURNING id INTO v_scan_id;
    RETURN jsonb_build_object('ok', false, 'result', 'unknown', 'scan_event_id', v_scan_id);
  END IF;

  SELECT COUNT(*) INTO v_existing
  FROM public.inventory_movements
  WHERE shipment_id = v_shipment.id AND movement_type = 'ship';

  IF v_existing > 0 THEN
    INSERT INTO public.scan_events (shipment_id, tracking_number, scan_type, result, message, scanned_by)
    VALUES (v_shipment.id, p_tracking_number, 'outbound', 'duplicate', 'Shipment already scanned for outbound stock movement', p_scanned_by)
    RETURNING id INTO v_scan_id;
    RETURN jsonb_build_object('ok', true, 'result', 'duplicate', 'shipment_id', v_shipment.id, 'scan_event_id', v_scan_id);
  END IF;

  SELECT id INTO v_main_location FROM public.inventory_locations WHERE code = 'MAIN' LIMIT 1;
  IF v_main_location IS NULL THEN RAISE EXCEPTION 'Inventory location MAIN is missing'; END IF;

  INSERT INTO public.scan_events (shipment_id, tracking_number, scan_type, result, scanned_by)
  VALUES (v_shipment.id, p_tracking_number, 'outbound', 'ok', p_scanned_by)
  RETURNING id INTO v_scan_id;

  FOR v_item IN
    SELECT oi.product_variant_id, oi.quantity
    FROM public.order_items oi
    WHERE oi.order_id = v_shipment.order_uuid AND oi.product_variant_id IS NOT NULL
  LOOP
    INSERT INTO public.inventory_movements (
      product_variant_id, order_uuid, order_id, shipment_id, scan_event_id, movement_type,
      quantity_change, from_location_id, created_by
    )
    VALUES (
      v_item.product_variant_id, v_shipment.order_uuid, v_shipment.order_id, v_shipment.id, v_scan_id, 'ship',
      -v_item.quantity, v_main_location, p_scanned_by
    );

    INSERT INTO public.inventory_balances (product_variant_id, location_id, quantity_on_hand)
    VALUES (v_item.product_variant_id, v_main_location, -v_item.quantity)
    ON CONFLICT (product_variant_id, location_id)
    DO UPDATE SET quantity_on_hand = public.inventory_balances.quantity_on_hand - v_item.quantity, updated_at = now();
  END LOOP;

  UPDATE public.fulfillment_items
  SET status = 'scanned',
      picked_at = COALESCE(picked_at, now()),
      packed_at = COALESCE(packed_at, now()),
      label_printed_at = COALESCE(label_printed_at, now()),
      scanned_at = now(),
      packed_by = COALESCE(packed_by, p_scanned_by),
      scanned_by = p_scanned_by,
      updated_at = now()
  WHERE shipment_id = v_shipment.id;

  UPDATE public.orders
  SET fulfillment_status = 'scanned', updated_at = now()
  WHERE id = v_shipment.order_uuid;

  RETURN jsonb_build_object('ok', true, 'result', 'ok', 'shipment_id', v_shipment.id, 'scan_event_id', v_scan_id);
END;
$$;
