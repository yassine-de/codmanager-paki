CREATE OR REPLACE FUNCTION public.resolve_single_inventory_variant(
  p_seller_id uuid,
  p_product_name text
)
RETURNS TABLE (
  product_id uuid,
  product_variant_id uuid,
  product_sku text,
  variant_sku text,
  variant_name text,
  weight_kg numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH matching_products AS (
    SELECT p.id
    FROM public.products p
    WHERE p.seller_id = p_seller_id
      AND p.active
      AND lower(btrim(p.name)) = lower(btrim(p_product_name))
  ),
  single_product AS (
    SELECT (array_agg(mp.id))[1] AS id
    FROM matching_products mp
    HAVING count(*) = 1
  ),
  single_variant AS (
    SELECT (array_agg(pv.id))[1] AS id
    FROM public.product_variants pv
    JOIN single_product sp ON sp.id = pv.product_id
    WHERE pv.active
    HAVING count(*) = 1
  )
  SELECT
    p.id,
    pv.id,
    p.sku,
    pv.sku,
    pv.name,
    COALESCE(pv.weight_kg, p.weight_kg)
  FROM single_product sp
  JOIN public.products p ON p.id = sp.id
  JOIN single_variant sv ON true
  JOIN public.product_variants pv ON pv.id = sv.id;
$$;

CREATE OR REPLACE FUNCTION public.sync_order_inventory_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match record;
  v_has_ship_movement boolean;
BEGIN
  SELECT * INTO v_match
  FROM public.resolve_single_inventory_variant(NEW.seller_id, NEW.product_name)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.inventory_movements im
    WHERE im.order_uuid = NEW.id
      AND im.movement_type = 'ship'
  ) INTO v_has_ship_movement;

  IF NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = NEW.id) THEN
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
    VALUES (
      NEW.id,
      v_match.product_id,
      v_match.product_variant_id,
      v_match.variant_sku,
      NEW.product_name,
      v_match.variant_name,
      GREATEST(COALESCE(NEW.quantity, 1), 1),
      COALESCE(NEW.price, 0),
      v_match.weight_kg,
      jsonb_build_object('auto_inventory_link', true)
    );
  ELSE
    UPDATE public.order_items oi
    SET product_id = v_match.product_id,
        product_variant_id = v_match.product_variant_id,
        sku = COALESCE(oi.sku, v_match.variant_sku),
        variant_name = COALESCE(oi.variant_name, v_match.variant_name),
        weight_kg = COALESCE(oi.weight_kg, v_match.weight_kg),
        metadata = COALESCE(oi.metadata, '{}'::jsonb) || jsonb_build_object('auto_inventory_link', true)
    WHERE oi.order_id = NEW.id
      AND oi.product_variant_id IS NULL
      AND lower(btrim(oi.product_name)) = lower(btrim(NEW.product_name));

    IF NOT v_has_ship_movement THEN
      UPDATE public.order_items oi
      SET quantity = GREATEST(COALESCE(NEW.quantity, 1), 1),
          unit_price = COALESCE(NEW.price, oi.unit_price),
          weight_kg = COALESCE(v_match.weight_kg, oi.weight_kg)
      WHERE oi.order_id = NEW.id
        AND oi.product_variant_id = v_match.product_variant_id
        AND COALESCE((oi.metadata ->> 'auto_inventory_link')::boolean, false);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_sync_inventory_item ON public.orders;
CREATE TRIGGER orders_sync_inventory_item
AFTER INSERT OR UPDATE OF seller_id, product_name, quantity, price, weight ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.sync_order_inventory_item();

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
  o.id,
  resolved.product_id,
  resolved.product_variant_id,
  resolved.variant_sku,
  o.product_name,
  resolved.variant_name,
  GREATEST(COALESCE(o.quantity, 1), 1),
  COALESCE(o.price, 0),
  resolved.weight_kg,
  jsonb_build_object('auto_inventory_link', true, 'backfilled', true)
FROM public.orders o
CROSS JOIN LATERAL public.resolve_single_inventory_variant(o.seller_id, o.product_name) resolved
WHERE NOT EXISTS (
  SELECT 1
  FROM public.order_items oi
  WHERE oi.order_id = o.id
);

UPDATE public.order_items oi
SET product_id = resolved.product_id,
    product_variant_id = resolved.product_variant_id,
    sku = COALESCE(oi.sku, resolved.variant_sku),
    variant_name = COALESCE(oi.variant_name, resolved.variant_name),
    weight_kg = COALESCE(oi.weight_kg, resolved.weight_kg),
    metadata = COALESCE(oi.metadata, '{}'::jsonb) || jsonb_build_object('auto_inventory_link', true, 'backfilled', true)
FROM public.orders o
CROSS JOIN LATERAL public.resolve_single_inventory_variant(o.seller_id, o.product_name) resolved
WHERE oi.order_id = o.id
  AND oi.product_variant_id IS NULL
  AND lower(btrim(oi.product_name)) = lower(btrim(o.product_name));

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
  v_main_location uuid;
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

  SELECT il.id INTO v_main_location
  FROM public.inventory_locations il
  WHERE il.code = 'MAIN'
  LIMIT 1;

  IF v_main_location IS NULL THEN
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
      v_main_location,
      p_created_by,
      jsonb_build_object('reason', 'order_entered_delivery_pool', 'delivery_status', v_order.delivery_status)
    );

    INSERT INTO public.inventory_balances (product_variant_id, location_id, quantity_on_hand)
    VALUES (v_item.product_variant_id, v_main_location, -v_item.quantity)
    ON CONFLICT (product_variant_id, location_id)
    DO UPDATE SET
      quantity_on_hand = public.inventory_balances.quantity_on_hand - v_item.quantity,
      updated_at = now();

    v_applied := v_applied + v_item.quantity;
  END LOOP;

  RETURN v_applied;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_stock_on_order_shipped()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.apply_inventory_ship_for_order(NEW.id, auth.uid());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_apply_stock_on_shipped ON public.orders;
CREATE TRIGGER orders_apply_stock_on_shipped
AFTER UPDATE OF delivery_status ON public.orders
FOR EACH ROW
WHEN (
  OLD.delivery_status IS DISTINCT FROM NEW.delivery_status
  AND NEW.delivery_status IN (
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
  )
)
EXECUTE FUNCTION public.apply_stock_on_order_shipped();

DO $$
DECLARE
  v_order record;
  v_deducted integer := 0;
BEGIN
  FOR v_order IN
    SELECT o.id
    FROM public.orders o
    WHERE o.delivery_status IN (
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
    )
  LOOP
    v_deducted := v_deducted + public.apply_inventory_ship_for_order(v_order.id, NULL);
  END LOOP;

  RAISE NOTICE 'Backfilled % shipped inventory unit(s)', v_deducted;
END;
$$;

NOTIFY pgrst, 'reload schema';
