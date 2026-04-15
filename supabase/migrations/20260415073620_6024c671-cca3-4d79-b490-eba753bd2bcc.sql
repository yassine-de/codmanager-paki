
-- Update the generate_seller_display_id function with collision-avoidance
CREATE OR REPLACE FUNCTION public.generate_seller_display_id(p_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parts text[];
  v_first text;
  v_last text;
  v_prefix text;
  v_counter integer;
  v_i integer;
  v_found boolean := false;
BEGIN
  v_parts := string_to_array(trim(p_name), ' ');
  v_first := v_parts[1];
  
  IF array_length(v_parts, 1) >= 2 THEN
    v_last := v_parts[array_length(v_parts, 1)];
  ELSE
    v_last := v_first;
  END IF;
  
  -- Strategy 1: first letter of first name + iterate each letter of last name
  FOR v_i IN 1..length(v_last) LOOP
    v_prefix := upper(left(v_first, 1) || substr(v_last, v_i, 1));
    IF NOT EXISTS (
      SELECT 1 FROM profiles WHERE display_id LIKE v_prefix || '-%'
    ) THEN
      v_found := true;
      EXIT;
    END IF;
  END LOOP;
  
  -- Strategy 2: iterate all combinations first_name[i] + last_name[j]
  IF NOT v_found THEN
    FOR v_i IN 1..length(v_first) LOOP
      FOR v_j IN 1..length(v_last) LOOP
        v_prefix := upper(substr(v_first, v_i, 1) || substr(v_last, v_j, 1));
        IF NOT EXISTS (
          SELECT 1 FROM profiles WHERE display_id LIKE v_prefix || '-%'
        ) THEN
          v_found := true;
          EXIT;
        END IF;
      END LOOP;
      IF v_found THEN EXIT; END IF;
    END LOOP;
  END IF;
  
  -- Fallback: first two letters of first name
  IF NOT v_found THEN
    v_prefix := upper(left(v_first, 2));
  END IF;
  
  -- Global counter representing total seller count
  v_counter := nextval('seller_display_id_seq');
  
  RETURN v_prefix || '-' || LPAD(v_counter::text, 2, '0');
END;
$$;
