CREATE OR REPLACE FUNCTION public.normalize_seller_code_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(regexp_replace(coalesce(p_name, ''), '[^A-Za-z ]', '', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.seller_code_is_available(
  p_code text,
  p_seller_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text := upper(btrim(coalesce(p_code, '')));
BEGIN
  IF length(v_code) < 2 THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.seller_order_prefixes sop
    WHERE upper(sop.prefix) = v_code
      AND (p_seller_id IS NULL OR sop.seller_id <> p_seller_id)
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE upper(NULLIF(split_part(p.display_id, '-', 1), '')) = v_code
      AND (p_seller_id IS NULL OR p.user_id <> p_seller_id)
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_unique_seller_code(
  p_name text,
  p_seller_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_name text := regexp_replace(coalesce(trim(p_name), ''), '\s+', ' ', 'g');
  v_parts text[];
  v_first text;
  v_last text;
  v_letters text;
  v_candidate text;
  v_base text;
  i integer;
  j integer;
BEGIN
  v_letters := regexp_replace(public.normalize_seller_code_name(v_clean_name), '[^A-Z]', '', 'g');

  IF v_letters = '' THEN
    v_first := 'S';
    v_last := 'L';
  ELSE
    v_parts := string_to_array(public.normalize_seller_code_name(v_clean_name), ' ');
    v_first := regexp_replace(coalesce(v_parts[1], v_letters), '[^A-Z]', '', 'g');
    v_last := regexp_replace(coalesce(v_parts[array_length(v_parts, 1)], v_first), '[^A-Z]', '', 'g');

    IF v_first = '' THEN
      v_first := left(v_letters, 1);
    END IF;
    IF v_last = '' THEN
      v_last := v_first;
    END IF;
  END IF;

  -- Prefer first initial + each available letter from the last name.
  FOR j IN 1..greatest(length(v_last), 1) LOOP
    v_candidate := upper(substr(v_first, 1, 1) || substr(v_last, j, 1));
    IF public.seller_code_is_available(v_candidate, p_seller_id) THEN
      RETURN v_candidate;
    END IF;
  END LOOP;

  -- Then try all first-name/last-name letter combinations.
  FOR i IN 1..greatest(length(v_first), 1) LOOP
    FOR j IN 1..greatest(length(v_last), 1) LOOP
      v_candidate := upper(substr(v_first, i, 1) || substr(v_last, j, 1));
      IF public.seller_code_is_available(v_candidate, p_seller_id) THEN
        RETURN v_candidate;
      END IF;
    END LOOP;
  END LOOP;

  -- Then try adjacent letters from the full name.
  FOR i IN 1..greatest(length(v_letters) - 1, 1) LOOP
    v_candidate := upper(substr(v_letters, i, 2));
    IF public.seller_code_is_available(v_candidate, p_seller_id) THEN
      RETURN v_candidate;
    END IF;
  END LOOP;

  -- Final deterministic fallback keeps the name base but adds a numeric suffix.
  v_base := upper(left(coalesce(nullif(v_letters, ''), 'SL') || 'SL', 2));
  FOR i IN 2..99 LOOP
    v_candidate := v_base || i::text;
    IF public.seller_code_is_available(v_candidate, p_seller_id) THEN
      RETURN v_candidate;
    END IF;
  END LOOP;

  RAISE EXCEPTION 'Could not generate unique seller code for %', p_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_seller_display_id(p_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.generate_unique_seller_code(p_name, NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_order_id(p_seller_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counter integer;
  v_prefix text;
  v_name text;
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

  SELECT name INTO v_name
  FROM public.profiles
  WHERE user_id = p_seller_id;

  v_prefix := public.generate_unique_seller_code(coalesce(v_name, 'Seller'), p_seller_id);

  INSERT INTO public.seller_order_prefixes (seller_id, prefix, current_counter)
  VALUES (p_seller_id, v_prefix, 1)
  ON CONFLICT (seller_id)
  DO UPDATE SET current_counter = public.seller_order_prefixes.current_counter + 1
  RETURNING prefix, current_counter INTO v_prefix, v_counter;

  RETURN v_prefix || '-' || v_counter::text;
END;
$$;

DO $$
DECLARE
  v_seller record;
  v_root text;
  v_code text;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS tmp_seen_seller_codes (
    code text PRIMARY KEY
  ) ON COMMIT DROP;

  TRUNCATE tmp_seen_seller_codes;

  FOR v_seller IN
    SELECT p.user_id, p.name, p.display_id, p.created_at
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.user_id
    WHERE ur.role = 'seller'
    ORDER BY p.created_at NULLS LAST, p.user_id
  LOOP
    v_root := upper(NULLIF(split_part(coalesce(v_seller.display_id, ''), '-', 1), ''));

    IF v_root IS NULL
      OR EXISTS (SELECT 1 FROM tmp_seen_seller_codes WHERE code = v_root)
    THEN
      v_code := public.generate_unique_seller_code(v_seller.name, v_seller.user_id);
      UPDATE public.profiles
      SET display_id = v_code
      WHERE user_id = v_seller.user_id;
    ELSE
      v_code := v_root;
      UPDATE public.profiles
      SET display_id = v_code
      WHERE user_id = v_seller.user_id
        AND display_id IS DISTINCT FROM v_code;
    END IF;

    INSERT INTO tmp_seen_seller_codes(code) VALUES (v_code)
    ON CONFLICT DO NOTHING;

    IF EXISTS (
      SELECT 1
      FROM public.seller_order_prefixes
      WHERE seller_id = v_seller.user_id
    ) THEN
      UPDATE public.seller_order_prefixes
      SET prefix = v_code
      WHERE seller_id = v_seller.user_id
        AND prefix IS DISTINCT FROM v_code;
    ELSE
      INSERT INTO public.seller_order_prefixes (seller_id, prefix, current_counter)
      VALUES (v_seller.user_id, v_code, 0);
    END IF;
  END LOOP;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_seller_display_root_unique
ON public.profiles (upper(NULLIF(split_part(display_id, '-', 1), '')))
WHERE display_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
