
-- Fix generate_product_sku function to use SECURITY DEFINER so it can access the sequence
CREATE OR REPLACE FUNCTION public.generate_product_sku()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN 'PRD-' || LPAD(nextval('product_sku_seq')::text, 3, '0');
END;
$function$;

-- Also grant usage on the sequence to authenticated users as a safety net
GRANT USAGE, SELECT ON SEQUENCE public.product_sku_seq TO authenticated;
