INSERT INTO public.fulfillment_items (
  order_uuid,
  order_id,
  shipment_id,
  status,
  created_at,
  updated_at
)
SELECT
  o.id,
  o.order_id,
  s.id,
  'pending'::public.fulfillment_item_status,
  now(),
  now()
FROM public.orders o
JOIN public.shipments s ON s.order_uuid = o.id
LEFT JOIN public.fulfillment_items fi ON fi.shipment_id = s.id
WHERE o.confirmation_status = 'confirmed'
  AND o.delivery_status = 'booked'
  AND s.tracking_number IS NOT NULL
  AND fi.id IS NULL
ON CONFLICT (shipment_id) DO NOTHING;

UPDATE public.orders o
SET fulfillment_status = 'pending',
    updated_at = now()
WHERE o.confirmation_status = 'confirmed'
  AND o.delivery_status = 'booked'
  AND EXISTS (
    SELECT 1
    FROM public.fulfillment_items fi
    WHERE fi.order_uuid = o.id
      AND fi.status = 'pending'
  )
  AND COALESCE(o.fulfillment_status, '') <> 'pending';
