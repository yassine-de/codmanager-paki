
-- Add display_id column to sourcing_requests
ALTER TABLE public.sourcing_requests ADD COLUMN display_id text;

-- Create counter table for sourcing IDs per seller
CREATE TABLE IF NOT EXISTS public.seller_sourcing_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL UNIQUE,
  current_counter integer NOT NULL DEFAULT 0
);

ALTER TABLE public.seller_sourcing_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage sourcing counters" ON public.seller_sourcing_counters
  FOR ALL TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

-- Function to generate sourcing display_id using seller prefix
CREATE OR REPLACE FUNCTION public.generate_sourcing_display_id(p_seller_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_prefix text;
  v_counter integer;
BEGIN
  SELECT prefix INTO v_prefix
  FROM seller_order_prefixes
  WHERE seller_id = p_seller_id;

  IF v_prefix IS NULL THEN
    v_prefix := 'SRC';
  END IF;

  INSERT INTO seller_sourcing_counters (seller_id, current_counter)
  VALUES (p_seller_id, 1)
  ON CONFLICT (seller_id)
  DO UPDATE SET current_counter = seller_sourcing_counters.current_counter + 1
  RETURNING current_counter INTO v_counter;

  RETURN v_prefix || '-S' || LPAD(v_counter::text, 3, '0');
END;
$$;

-- Trigger to auto-generate display_id on insert
CREATE OR REPLACE FUNCTION public.set_sourcing_display_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.display_id IS NULL OR NEW.display_id = '' THEN
    NEW.display_id := generate_sourcing_display_id(NEW.seller_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_sourcing_display_id
  BEFORE INSERT ON public.sourcing_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.set_sourcing_display_id();

-- Backfill existing records
UPDATE public.sourcing_requests
SET display_id = generate_sourcing_display_id(seller_id)
WHERE display_id IS NULL;
