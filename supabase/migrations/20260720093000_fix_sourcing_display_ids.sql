CREATE OR REPLACE FUNCTION public.generate_sourcing_display_id(p_seller_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counter integer;
  v_prefix text;
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

  INSERT INTO public.seller_sourcing_counters (seller_id, current_counter)
  VALUES (p_seller_id, 1)
  ON CONFLICT (seller_id) DO UPDATE
    SET current_counter = public.seller_sourcing_counters.current_counter + 1
  RETURNING current_counter INTO v_counter;

  RETURN v_prefix || '-S' || lpad(v_counter::text, 3, '0');
END;
$$;
CREATE OR REPLACE FUNCTION public.set_sourcing_request_display_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.display_id IS NULL OR btrim(NEW.display_id) = '' THEN
    NEW.display_id := public.generate_sourcing_display_id(NEW.seller_id);
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_set_sourcing_request_display_id ON public.sourcing_requests;
CREATE TRIGGER trg_set_sourcing_request_display_id
BEFORE INSERT ON public.sourcing_requests
FOR EACH ROW
EXECUTE FUNCTION public.set_sourcing_request_display_id();
DO $$
DECLARE
  v_request record;
BEGIN
  FOR v_request IN
    SELECT id, seller_id
    FROM public.sourcing_requests
    WHERE display_id IS NULL OR btrim(display_id) = ''
    ORDER BY created_at ASC, id ASC
  LOOP
    UPDATE public.sourcing_requests
    SET display_id = public.generate_sourcing_display_id(v_request.seller_id)
    WHERE id = v_request.id;
  END LOOP;
END;
$$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sourcing_requests_display_id_unique
ON public.sourcing_requests(display_id)
WHERE display_id IS NOT NULL;
