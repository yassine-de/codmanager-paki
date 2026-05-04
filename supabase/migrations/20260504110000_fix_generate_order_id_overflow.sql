-- Fix: LPAD(counter, 3, '0') truncates when counter >= 1000, producing IDs like
-- "ANW-100" which already exist → duplicate key constraint violation.
-- PostgreSQL LPAD truncates strings longer than the target length (from the right).
-- Fix: keep 3-digit zero-padded format for 1–999, use plain number for 1000+.

CREATE OR REPLACE FUNCTION public.generate_order_id(p_seller_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_prefix  text;
  v_counter integer;
BEGIN
  UPDATE seller_order_prefixes
  SET current_counter = current_counter + 1
  WHERE seller_id = p_seller_id
  RETURNING prefix, current_counter INTO v_prefix, v_counter;

  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'No prefix found for seller %', p_seller_id;
  END IF;

  -- Keep existing 3-digit format for ≤ 999; plain number above to avoid LPAD truncation
  RETURN v_prefix || '-' || CASE
    WHEN v_counter < 1000 THEN LPAD(v_counter::text, 3, '0')
    ELSE v_counter::text
  END;
END;
$$;

NOTIFY pgrst, 'reload schema';
