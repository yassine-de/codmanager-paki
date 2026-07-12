CREATE TEMP TABLE cleanup_target_products (
  id uuid PRIMARY KEY
) ON COMMIT DROP;

CREATE TEMP TABLE cleanup_target_variants (
  id uuid PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO cleanup_target_products (id)
SELECT DISTINCT p.id
FROM public.products p
WHERE p.sku IN (
  'TEST-20260705080416-SKU',
  'WH-46B543-TEMPLARXII-E65D61',
  'WH-46B543-NHCFTREEWS-50AE57'
)
OR EXISTS (
  SELECT 1
  FROM public.product_variants pv
  WHERE pv.product_id = p.id
    AND pv.sku IN (
      'TEST-20260705080416-SKU',
      'WH-46B543-TEMPLARXII-E65D61',
      'WH-46B543-NHCFTREEWS-50AE57'
    )
);

INSERT INTO cleanup_target_variants (id)
SELECT DISTINCT pv.id
FROM public.product_variants pv
WHERE pv.product_id IN (SELECT id FROM cleanup_target_products)
   OR pv.sku IN (
    'TEST-20260705080416-SKU',
    'WH-46B543-TEMPLARXII-E65D61',
    'WH-46B543-NHCFTREEWS-50AE57'
  );

DO $$
DECLARE
  v_product_count integer;
  v_variant_count integer;
BEGIN
  SELECT COUNT(*) INTO v_product_count FROM cleanup_target_products;
  SELECT COUNT(*) INTO v_variant_count FROM cleanup_target_variants;
  RAISE NOTICE 'Removing requested products: % product(s), % variant(s)', v_product_count, v_variant_count;
END $$;

UPDATE public.sourcing_requests
SET source_product_id = NULL
WHERE source_product_id IN (SELECT id FROM cleanup_target_products);

UPDATE public.invoice_addons
SET product_id = NULL
WHERE product_id IN (SELECT id FROM cleanup_target_products);

UPDATE public.order_items
SET product_id = NULL,
    product_variant_id = NULL
WHERE product_id IN (SELECT id FROM cleanup_target_products)
   OR product_variant_id IN (SELECT id FROM cleanup_target_variants);

UPDATE public.return_receipt_items
SET product_variant_id = NULL
WHERE product_variant_id IN (SELECT id FROM cleanup_target_variants);

DELETE FROM public.inventory_movements
WHERE product_variant_id IN (SELECT id FROM cleanup_target_variants);

DELETE FROM public.inventory_balances
WHERE product_variant_id IN (SELECT id FROM cleanup_target_variants);

DELETE FROM public.product_variants
WHERE id IN (SELECT id FROM cleanup_target_variants)
   OR product_id IN (SELECT id FROM cleanup_target_products);

DELETE FROM public.products
WHERE id IN (SELECT id FROM cleanup_target_products);
