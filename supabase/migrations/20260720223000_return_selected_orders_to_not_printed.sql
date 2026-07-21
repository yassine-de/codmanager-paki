WITH target_orders AS (
  SELECT id, order_id
  FROM public.orders
  WHERE order_id = ANY (ARRAY[
    'AB-17',
    'AB-20',
    'AB-32',
    'AB-54',
    'AB-60',
    'AB-63',
    'AB-76',
    'AB-82',
    'AB-86',
    'AB-87',
    'AB-90',
    'AB-91',
    'AB-112',
    'AB-117',
    'AB-128',
    'AB-154'
  ])
),
target_shipments AS (
  SELECT DISTINCT ON (target.id)
    shipment.id AS shipment_id,
    target.id AS order_uuid,
    target.order_id
  FROM target_orders target
  JOIN public.shipments shipment ON shipment.order_uuid = target.id
  WHERE shipment.tracking_number IS NOT NULL
  ORDER BY target.id, shipment.created_at DESC
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
FROM target_shipments
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
WHERE order_id = ANY (ARRAY[
  'AB-17',
  'AB-20',
  'AB-32',
  'AB-54',
  'AB-60',
  'AB-63',
  'AB-76',
  'AB-82',
  'AB-86',
  'AB-87',
  'AB-90',
  'AB-91',
  'AB-112',
  'AB-117',
  'AB-128',
  'AB-154'
]);

NOTIFY pgrst, 'reload schema';
