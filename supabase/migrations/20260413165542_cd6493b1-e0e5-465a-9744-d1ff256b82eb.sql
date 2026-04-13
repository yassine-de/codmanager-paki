
-- Add display_id to profiles
ALTER TABLE public.profiles ADD COLUMN display_id text UNIQUE;

-- Counter table for seller display ID prefixes
CREATE TABLE public.seller_display_id_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prefix text NOT NULL UNIQUE,
  current_counter integer NOT NULL DEFAULT 0
);

ALTER TABLE public.seller_display_id_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage seller_display_id_counters"
  ON public.seller_display_id_counters FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- Function to generate seller display_id from name
CREATE OR REPLACE FUNCTION public.generate_seller_display_id(p_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_parts text[];
  v_prefix text;
  v_counter integer;
BEGIN
  -- Split name into parts and take first letter of each (up to 3)
  v_parts := string_to_array(trim(p_name), ' ');
  v_prefix := '';
  FOR i IN 1..LEAST(array_length(v_parts, 1), 3) LOOP
    v_prefix := v_prefix || upper(left(v_parts[i], 1));
  END LOOP;
  
  IF v_prefix = '' THEN
    v_prefix := 'SLR';
  END IF;

  -- Upsert counter
  INSERT INTO seller_display_id_counters (prefix, current_counter)
  VALUES (v_prefix, 1)
  ON CONFLICT (prefix)
  DO UPDATE SET current_counter = seller_display_id_counters.current_counter + 1
  RETURNING current_counter INTO v_counter;

  RETURN v_prefix || '-' || LPAD(v_counter::text, 3, '0');
END;
$$;
