WITH target_order AS (
  SELECT id, order_id
  FROM public.orders
  WHERE order_id = 'AB-32'
),
target_shipment AS (
  SELECT s.id AS shipment_id, t.id AS order_uuid, t.order_id
  FROM target_order t
  JOIN public.shipments s ON s.order_uuid = t.id
  WHERE s.tracking_number IS NOT NULL
  ORDER BY s.created_at DESC
  LIMIT 1
)
INSERT INTO public.fulfillment_items (
  order_uuid,
  order_id,
  shipment_id,
  status,
  created_at,
  updated_at
)
SELECT
  order_uuid,
  order_id,
  shipment_id,
  'pending'::public.fulfillment_item_status,
  now(),
  now()
FROM target_shipment
ON CONFLICT (shipment_id) DO UPDATE
SET status = 'pending',
    label_printed_at = NULL,
    packed_at = NULL,
    packed_by = NULL,
    updated_at = now();

UPDATE public.orders
SET delivery_status = 'booked',
    fulfillment_status = 'pending',
    updated_at = now()
WHERE order_id = 'AB-32';
