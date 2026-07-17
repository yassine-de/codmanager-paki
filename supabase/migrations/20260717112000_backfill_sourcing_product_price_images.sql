UPDATE public.products p
SET
  landed_price = CASE
    WHEN sr.seller_price IS NOT NULL AND sr.seller_price > 0 THEN sr.seller_price
    WHEN (p.landed_price IS NULL OR p.landed_price = 0) AND sr.landed_price IS NOT NULL THEN sr.landed_price
    ELSE p.landed_price
  END,
  image_url = CASE
    WHEN NULLIF(sr.product_image_url, '') IS NOT NULL THEN sr.product_image_url
    ELSE p.image_url
  END,
  scraped_image_url = CASE
    WHEN NULLIF(sr.product_image_url, '') IS NOT NULL THEN sr.product_image_url
    ELSE p.scraped_image_url
  END,
  product_url = COALESCE(NULLIF(p.product_url, ''), NULLIF(sr.product_url, ''), p.product_url),
  weight = COALESCE(NULLIF(p.weight, ''), NULLIF(sr.product_weight, ''), p.weight),
  updated_at = now()
FROM public.sourcing_requests sr
WHERE p.sourcing_request_id = sr.id
  AND (
    (sr.seller_price IS NOT NULL AND sr.seller_price > 0 AND p.landed_price IS DISTINCT FROM sr.seller_price)
    OR ((p.landed_price IS NULL OR p.landed_price = 0) AND sr.landed_price IS NOT NULL)
    OR (NULLIF(sr.product_image_url, '') IS NOT NULL AND (
      p.image_url IS DISTINCT FROM sr.product_image_url
      OR p.scraped_image_url IS DISTINCT FROM sr.product_image_url
    ))
    OR (NULLIF(p.product_url, '') IS NULL AND NULLIF(sr.product_url, '') IS NOT NULL)
    OR (NULLIF(p.weight, '') IS NULL AND NULLIF(sr.product_weight, '') IS NOT NULL)
  );
