CREATE OR REPLACE VIEW public.fulfillment_queue_view AS
SELECT
  fi.id AS fulfillment_item_id,
  fi.status AS fulfillment_item_status,
  fi.batch_id,
  fb.batch_number,
  o.id AS order_uuid,
  o.order_id,
  o.system_id,
  o.customer_name,
  o.customer_city,
  o.total_amount,
  sh.id AS shipment_id,
  sh.tracking_number,
  sh.normalized_status,
  c.id AS carrier_id,
  c.code AS carrier_code,
  c.name AS carrier_name,
  fi.created_at,
  fi.updated_at,
  COALESCE(items.product_names, o.product_name) AS product_name,
  COALESCE(items.item_count, 1) AS item_count
FROM public.fulfillment_items fi
JOIN public.orders o ON o.id = fi.order_uuid
JOIN public.shipments sh ON sh.id = fi.shipment_id
JOIN public.carriers c ON c.id = sh.carrier_id
LEFT JOIN public.fulfillment_batches fb ON fb.id = fi.batch_id
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)::integer AS item_count,
    string_agg(DISTINCT oi.product_name, ', ' ORDER BY oi.product_name) AS product_names
  FROM public.order_items oi
  WHERE oi.order_id = o.id
) items ON true;
