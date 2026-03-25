
-- Sourcing requests table for sellers
CREATE TABLE public.sourcing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL,
  product_name text NOT NULL,
  quantity integer NOT NULL DEFAULT 0,
  destination_country text NOT NULL DEFAULT '',
  shipping_method text NOT NULL DEFAULT 'sea',
  product_url text NOT NULL DEFAULT '',
  notes text DEFAULT '',
  status text NOT NULL DEFAULT 'waiting_quote',
  unit_price numeric DEFAULT 0,
  shipping_cost numeric DEFAULT 0,
  total_price numeric DEFAULT 0,
  seller_validated boolean DEFAULT null,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sourcing_requests ENABLE ROW LEVEL SECURITY;

-- Sellers can view their own requests
CREATE POLICY "Sellers can view own sourcing requests"
ON public.sourcing_requests FOR SELECT TO authenticated
USING (auth.uid() = seller_id);

-- Sellers can insert their own requests
CREATE POLICY "Sellers can create sourcing requests"
ON public.sourcing_requests FOR INSERT TO authenticated
WITH CHECK (auth.uid() = seller_id);

-- Sellers can update only seller_validated field
CREATE POLICY "Sellers can validate own requests"
ON public.sourcing_requests FOR UPDATE TO authenticated
USING (auth.uid() = seller_id);

-- Admins full access
CREATE POLICY "Admins full access sourcing requests"
ON public.sourcing_requests FOR ALL TO authenticated
USING (is_admin(auth.uid()))
WITH CHECK (is_admin(auth.uid()));
