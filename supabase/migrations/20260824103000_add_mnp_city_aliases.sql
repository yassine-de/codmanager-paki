UPDATE public.carrier_city_cache
SET aliases = (
  SELECT jsonb_agg(DISTINCT alias_value)
  FROM jsonb_array_elements_text(
    COALESCE(aliases, '[]'::jsonb) || '["DERA GHAZI KHAN"]'::jsonb
  ) AS alias_value
)
WHERE lower(city_name) = 'd.g. khan'
  AND NOT (COALESCE(aliases, '[]'::jsonb) ? 'DERA GHAZI KHAN');

UPDATE public.carrier_city_cache
SET aliases = (
  SELECT jsonb_agg(DISTINCT alias_value)
  FROM jsonb_array_elements_text(
    COALESCE(aliases, '[]'::jsonb) || '["BAHAWALPUR"]'::jsonb
  ) AS alias_value
)
WHERE lower(city_name) = 'bhawalpur'
  AND NOT (COALESCE(aliases, '[]'::jsonb) ? 'BAHAWALPUR');
