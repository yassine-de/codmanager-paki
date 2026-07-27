CREATE OR REPLACE FUNCTION public.generate_sourcing_display_id(p_seller_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counter integer;
  v_prefix text;
  v_candidate text;
  v_attempts integer := 0;
BEGIN
  SELECT NULLIF(split_part(display_id, '-', 1), '')
    INTO v_prefix
  FROM public.profiles
  WHERE user_id = p_seller_id;

  IF v_prefix IS NULL THEN
    SELECT upper(left(regexp_replace(coalesce(name, 'SR'), '[^A-Za-z0-9]', '', 'g'), 2))
      INTO v_prefix
    FROM public.profiles
    WHERE user_id = p_seller_id;
  END IF;

  v_prefix := coalesce(NULLIF(v_prefix, ''), 'SR');

  LOOP
    INSERT INTO public.seller_sourcing_counters (seller_id, current_counter)
    VALUES (p_seller_id, 1)
    ON CONFLICT (seller_id) DO UPDATE
      SET current_counter = public.seller_sourcing_counters.current_counter + 1
    RETURNING current_counter INTO v_counter;

    v_candidate := v_prefix || '-S' || lpad(v_counter::text, 3, '0');

    IF NOT EXISTS (
      SELECT 1
      FROM public.sourcing_requests
      WHERE display_id = v_candidate
    ) THEN
      RETURN v_candidate;
    END IF;

    v_attempts := v_attempts + 1;
    IF v_attempts > 10000 THEN
      RAISE EXCEPTION 'Could not generate unique sourcing display_id for seller % with prefix %', p_seller_id, v_prefix;
    END IF;
  END LOOP;
END;
$$;
