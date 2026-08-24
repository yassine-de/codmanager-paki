DO $$
DECLARE
  v_mnp_id uuid;
BEGIN
  SELECT id INTO v_mnp_id FROM public.carriers WHERE code = 'mnp';
  IF v_mnp_id IS NULL THEN
    RAISE NOTICE 'M&P carrier is not configured; skipping M&P alias restore.';
    RETURN;
  END IF;

  UPDATE public.carrier_city_cache
  SET aliases = (
    SELECT jsonb_agg(DISTINCT alias_value)
    FROM jsonb_array_elements_text(COALESCE(aliases, '[]'::jsonb) || '["SARGODHA"]'::jsonb) AS alias_value
  )
  WHERE carrier_id = v_mnp_id AND lower(city_name) = 'sargodah'
    AND NOT (COALESCE(aliases, '[]'::jsonb) ? 'SARGODHA');

  UPDATE public.carrier_city_cache
  SET aliases = (
    SELECT jsonb_agg(DISTINCT alias_value)
    FROM jsonb_array_elements_text(COALESCE(aliases, '[]'::jsonb) || '["DERA GHAZI KHAN"]'::jsonb) AS alias_value
  )
  WHERE carrier_id = v_mnp_id AND lower(city_name) = 'd.g. khan'
    AND NOT (COALESCE(aliases, '[]'::jsonb) ? 'DERA GHAZI KHAN');

  UPDATE public.carrier_city_cache
  SET aliases = (
    SELECT jsonb_agg(DISTINCT alias_value)
    FROM jsonb_array_elements_text(COALESCE(aliases, '[]'::jsonb) || '["BAHAWALPUR"]'::jsonb) AS alias_value
  )
  WHERE carrier_id = v_mnp_id AND lower(city_name) = 'bhawalpur'
    AND NOT (COALESCE(aliases, '[]'::jsonb) ? 'BAHAWALPUR');

  UPDATE public.carrier_city_cache
  SET aliases = (
    SELECT jsonb_agg(DISTINCT alias_value)
    FROM jsonb_array_elements_text(COALESCE(aliases, '[]'::jsonb) || '["BUNER DISTRICT"]'::jsonb) AS alias_value
  )
  WHERE carrier_id = v_mnp_id AND lower(city_name) = 'buner'
    AND NOT (COALESCE(aliases, '[]'::jsonb) ? 'BUNER DISTRICT');

  UPDATE public.carrier_city_cache
  SET aliases = (
    SELECT jsonb_agg(DISTINCT alias_value)
    FROM jsonb_array_elements_text(COALESCE(aliases, '[]'::jsonb) || '["BAHAWALNAGAR"]'::jsonb) AS alias_value
  )
  WHERE carrier_id = v_mnp_id AND lower(city_name) = 'bawalnagar'
    AND NOT (COALESCE(aliases, '[]'::jsonb) ? 'BAHAWALNAGAR');

  UPDATE public.carrier_city_cache
  SET aliases = (
    SELECT jsonb_agg(DISTINCT alias_value)
    FROM jsonb_array_elements_text(COALESCE(aliases, '[]'::jsonb) || '["CHARSADDA"]'::jsonb) AS alias_value
  )
  WHERE carrier_id = v_mnp_id AND lower(city_name) = 'charsada'
    AND NOT (COALESCE(aliases, '[]'::jsonb) ? 'CHARSADDA');

  UPDATE public.carrier_city_cache
  SET aliases = (
    SELECT jsonb_agg(DISTINCT alias_value)
    FROM jsonb_array_elements_text(COALESCE(aliases, '[]'::jsonb) || '["ABBOTTABAD"]'::jsonb) AS alias_value
  )
  WHERE carrier_id = v_mnp_id AND lower(city_name) = 'abottabad'
    AND NOT (COALESCE(aliases, '[]'::jsonb) ? 'ABBOTTABAD');

  UPDATE public.carrier_city_cache
  SET aliases = (
    SELECT jsonb_agg(DISTINCT alias_value)
    FROM jsonb_array_elements_text(COALESCE(aliases, '[]'::jsonb) || '["SWAT"]'::jsonb) AS alias_value
  )
  WHERE carrier_id = v_mnp_id AND lower(city_name) = 'swat (mingora city)'
    AND NOT (COALESCE(aliases, '[]'::jsonb) ? 'SWAT');

  UPDATE public.carrier_city_cache
  SET aliases = (
    SELECT jsonb_agg(DISTINCT alias_value)
    FROM jsonb_array_elements_text(COALESCE(aliases, '[]'::jsonb) || '["DERA ISMAIL KHAN"]'::jsonb) AS alias_value
  )
  WHERE carrier_id = v_mnp_id AND lower(city_name) = 'd.i. khan'
    AND NOT (COALESCE(aliases, '[]'::jsonb) ? 'DERA ISMAIL KHAN');

  UPDATE public.carrier_city_cache
  SET aliases = (
    SELECT jsonb_agg(DISTINCT alias_value)
    FROM jsonb_array_elements_text(COALESCE(aliases, '[]'::jsonb) || '["ABDUL HAKEEM"]'::jsonb) AS alias_value
  )
  WHERE carrier_id = v_mnp_id AND lower(city_name) = 'abdul hakim /tulamba'
    AND NOT (COALESCE(aliases, '[]'::jsonb) ? 'ABDUL HAKEEM');

  UPDATE public.carrier_city_cache
  SET aliases = COALESCE(NULLIF(
    COALESCE(aliases, '[]'::jsonb)
      - 'SARGODHA'
      - 'DERA GHAZI KHAN'
      - 'BAHAWALPUR'
      - 'BUNER DISTRICT'
      - 'BAHAWALNAGAR'
      - 'CHARSADDA'
      - 'ABBOTTABAD'
      - 'SWAT'
      - 'DERA ISMAIL KHAN'
      - 'ABDUL HAKEEM',
    '[]'::jsonb
  ), '[]'::jsonb)
  WHERE carrier_id <> v_mnp_id;
END $$;
