CREATE OR REPLACE FUNCTION public.generate_product_sku()
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN 'PRD-' || LPAD(nextval('product_sku_seq')::text, 3, '0');
END;
$$;