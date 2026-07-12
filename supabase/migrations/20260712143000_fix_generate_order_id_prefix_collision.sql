CREATE OR REPLACE FUNCTION public.generate_order_id(p_seller_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counter integer;
  v_prefix text;
  v_base_prefix text := 'TZ';
  v_attempt integer := 0;
BEGIN
  SELECT prefix, current_counter + 1
    INTO v_prefix, v_counter
  FROM public.seller_order_prefixes
  WHERE seller_id = p_seller_id
  FOR UPDATE;

  IF v_counter IS NOT NULL THEN
    UPDATE public.seller_order_prefixes
    SET current_counter = v_counter
    WHERE seller_id = p_seller_id;

    RETURN v_prefix || '-' || v_counter::text;
  END IF;

  LOOP
    v_prefix := CASE
      WHEN v_attempt = 0 THEN v_base_prefix
      ELSE v_base_prefix || '-' || upper(substr(replace(p_seller_id::text, '-', ''), 1, 4 + v_attempt))
    END;

    BEGIN
      INSERT INTO public.seller_order_prefixes (seller_id, prefix, current_counter)
      VALUES (p_seller_id, v_prefix, 1)
      RETURNING current_counter INTO v_counter;

      RETURN v_prefix || '-' || v_counter::text;
    EXCEPTION
      WHEN unique_violation THEN
        v_attempt := v_attempt + 1;
        IF v_attempt > 20 THEN
          RAISE EXCEPTION 'Could not allocate unique order prefix for seller %', p_seller_id;
        END IF;
    END;
  END LOOP;
END;
$$;
