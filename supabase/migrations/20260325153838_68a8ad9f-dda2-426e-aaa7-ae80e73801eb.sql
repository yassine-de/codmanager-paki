
-- Add product_created flag to sourcing_requests
ALTER TABLE public.sourcing_requests
  ADD COLUMN IF NOT EXISTS product_created boolean DEFAULT NULL;

-- Create products table
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL,
  sku text NOT NULL,
  name text NOT NULL,
  image_url text DEFAULT '',
  price numeric NOT NULL DEFAULT 0,
  landed_price numeric DEFAULT 0,
  quantity integer NOT NULL DEFAULT 0,
  product_url text DEFAULT '',
  sourcing_request_id uuid REFERENCES public.sourcing_requests(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Admins full access products" ON public.products
  FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Sellers can view own products" ON public.products
  FOR SELECT TO authenticated
  USING (auth.uid() = seller_id);

-- Auto-generate SKU sequence
CREATE SEQUENCE IF NOT EXISTS product_sku_seq START 1001;

-- Function to generate SKU
CREATE OR REPLACE FUNCTION public.generate_product_sku()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN 'PRD-' || LPAD(nextval('product_sku_seq')::text, 5, '0');
END;
$$;
