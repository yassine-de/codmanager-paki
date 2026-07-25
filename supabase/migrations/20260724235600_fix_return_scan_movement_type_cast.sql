CREATE OR REPLACE FUNCTION public.scan_return_shipment(
  p_tracking_number text,
  p_condition public.return_condition,
  p_scanned_by uuid DEFAULT auth.uid(),
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shipment public.shipments%ROWTYPE;
  v_scan_id uuid;
  v_location uuid;
  v_existing integer;
  v_receipt_id uuid;
  v_item record;
BEGIN
  SELECT * INTO v_shipment
  FROM public.shipments
  WHERE tracking_number = p_tracking_number
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.scan_events (tracking_number, scan_type, result, message, scanned_by)
    VALUES (p_tracking_number, 'return', 'unknown', 'Unknown return tracking number', p_scanned_by)
    RETURNING id INTO v_scan_id;
    RETURN jsonb_build_object('ok', false, 'result', 'unknown', 'scan_event_id', v_scan_id);
  END IF;

  SELECT COUNT(*) INTO v_existing FROM public.return_receipts WHERE shipment_id = v_shipment.id;
  IF v_existing > 0 THEN
    INSERT INTO public.scan_events (shipment_id, tracking_number, scan_type, result, message, scanned_by)
    VALUES (v_shipment.id, p_tracking_number, 'return', 'duplicate', 'Return already received', p_scanned_by)
    RETURNING id INTO v_scan_id;
    RETURN jsonb_build_object('ok', true, 'result', 'duplicate', 'shipment_id', v_shipment.id, 'scan_event_id', v_scan_id);
  END IF;

  IF p_condition <> 'missing_item' THEN
    SELECT id INTO v_location
    FROM public.inventory_locations
    WHERE code = CASE
      WHEN p_condition = 'sellable' THEN 'MAIN'
      WHEN p_condition = 'damaged' THEN 'DAMAGED'
      ELSE 'RETURNS'
    END
    LIMIT 1;

    IF v_location IS NULL THEN
      RAISE EXCEPTION 'Required return inventory location is missing';
    END IF;
  END IF;

  INSERT INTO public.scan_events (shipment_id, tracking_number, scan_type, result, scanned_by)
  VALUES (v_shipment.id, p_tracking_number, 'return', 'ok', p_scanned_by)
  RETURNING id INTO v_scan_id;

  INSERT INTO public.return_receipts (shipment_id, order_uuid, order_id, scan_event_id, condition, received_by, note)
  VALUES (v_shipment.id, v_shipment.order_uuid, v_shipment.order_id, v_scan_id, p_condition, p_scanned_by, p_note)
  RETURNING id INTO v_receipt_id;

  FOR v_item IN
    SELECT oi.id AS order_item_id, oi.product_variant_id, oi.quantity
    FROM public.order_items oi
    WHERE oi.order_id = v_shipment.order_uuid AND oi.product_variant_id IS NOT NULL
  LOOP
    INSERT INTO public.return_receipt_items (
      return_receipt_id, order_item_id, product_variant_id, expected_quantity, received_quantity, condition
    )
    VALUES (v_receipt_id, v_item.order_item_id, v_item.product_variant_id, v_item.quantity, v_item.quantity, p_condition);

    IF v_location IS NOT NULL THEN
      INSERT INTO public.inventory_movements (
        product_variant_id, order_uuid, order_id, shipment_id, scan_event_id, movement_type,
        quantity_change, to_location_id, created_by
      )
      VALUES (
        v_item.product_variant_id, v_shipment.order_uuid, v_shipment.order_id, v_shipment.id, v_scan_id,
        CASE
          WHEN p_condition = 'sellable' THEN 'restock'::public.inventory_movement_type
          ELSE 'return_received'::public.inventory_movement_type
        END,
        v_item.quantity, v_location, p_scanned_by
      );

      INSERT INTO public.inventory_balances (product_variant_id, location_id, quantity_on_hand)
      VALUES (v_item.product_variant_id, v_location, v_item.quantity)
      ON CONFLICT (product_variant_id, location_id)
      DO UPDATE SET quantity_on_hand = public.inventory_balances.quantity_on_hand + v_item.quantity, updated_at = now();
    END IF;
  END LOOP;

  UPDATE public.shipments SET normalized_status = 'return_received', updated_at = now() WHERE id = v_shipment.id;
  UPDATE public.orders
  SET delivery_status = 'return_received',
      fulfillment_status = CASE
        WHEN p_condition = 'sellable' THEN 'restocked'
        WHEN p_condition = 'damaged' THEN 'damaged_return'
        WHEN p_condition = 'missing_item' THEN 'missing_return'
        ELSE 'return_inspection'
      END,
      updated_at = now()
  WHERE id = v_shipment.order_uuid;

  RETURN jsonb_build_object('ok', true, 'result', 'ok', 'shipment_id', v_shipment.id, 'scan_event_id', v_scan_id, 'return_receipt_id', v_receipt_id);
END;
$$;
