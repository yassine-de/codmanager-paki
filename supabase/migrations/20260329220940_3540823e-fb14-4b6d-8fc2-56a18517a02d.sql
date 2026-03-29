
-- Add display_id column to products
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS display_id text UNIQUE;

-- Create a counter table for product IDs per seller
CREATE TABLE IF NOT EXISTS public.seller_product_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL UNIQUE,
  current_counter integer NOT NULL DEFAULT 0
);

-- Enable RLS
ALTER TABLE public.seller_product_counters ENABLE ROW LEVEL SECURITY;

-- Only admins and internal functions need access
CREATE POLICY "Admins manage product counters"
  ON public.seller_product_counters FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- Function to generate product display_id
CREATE OR REPLACE FUNCTION public.generate_product_display_id(p_seller_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_prefix text;
  v_counter integer;
BEGIN
  -- Get the seller's prefix from order prefixes (reuse existing system)
  SELECT prefix INTO v_prefix
  FROM seller_order_prefixes
  WHERE seller_id = p_seller_id;

  IF v_prefix IS NULL THEN
    v_prefix := 'PRD';
  END IF;

  -- Upsert and increment counter
  INSERT INTO seller_product_counters (seller_id, current_counter)
  VALUES (p_seller_id, 1)
  ON CONFLICT (seller_id)
  DO UPDATE SET current_counter = seller_product_counters.current_counter + 1
  RETURNING current_counter INTO v_counter;

  RETURN v_prefix || '-P' || LPAD(v_counter::text, 3, '0');
END;
$$;

-- Backfill existing products with display_ids
DO $$
DECLARE
  rec RECORD;
  new_id text;
BEGIN
  FOR rec IN
    SELECT id, seller_id, created_at
    FROM products
    WHERE display_id IS NULL
    ORDER BY created_at ASC
  LOOP
    SELECT generate_product_display_id(rec.seller_id) INTO new_id;
    UPDATE products SET display_id = new_id WHERE id = rec.id;
  END LOOP;
END;
$$;
