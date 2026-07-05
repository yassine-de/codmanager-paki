UPDATE public.seller_order_prefixes
SET prefix = 'TZ'
WHERE prefix IS DISTINCT FROM 'TZ';

CREATE OR REPLACE FUNCTION public.generate_order_id(p_seller_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counter integer;
BEGIN
  SELECT current_counter + 1
    INTO v_counter
  FROM public.seller_order_prefixes
  WHERE seller_id = p_seller_id
  FOR UPDATE;

  IF v_counter IS NULL THEN
    INSERT INTO public.seller_order_prefixes (seller_id, prefix, current_counter)
    VALUES (p_seller_id, 'TZ', 1)
    ON CONFLICT (seller_id) DO UPDATE SET prefix = 'TZ', current_counter = public.seller_order_prefixes.current_counter + 1
    RETURNING current_counter INTO v_counter;
  ELSE
    UPDATE public.seller_order_prefixes
    SET prefix = 'TZ', current_counter = v_counter
    WHERE seller_id = p_seller_id;
  END IF;

  RETURN 'TZ-' || v_counter::text;
END;
$$;
