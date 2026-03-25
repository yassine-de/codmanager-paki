
-- Orders table
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL UNIQUE,
  seller_id uuid NOT NULL,
  agent_id uuid,
  customer_name text NOT NULL DEFAULT '',
  customer_phone text NOT NULL DEFAULT '',
  customer_city text NOT NULL DEFAULT '',
  customer_address text DEFAULT '',
  product_name text NOT NULL DEFAULT '',
  product_url text DEFAULT '',
  video_url text DEFAULT '',
  store_url text DEFAULT '',
  quantity integer NOT NULL DEFAULT 1,
  price numeric NOT NULL DEFAULT 0,
  last_price numeric,
  offers text DEFAULT '',
  shipping_cost numeric DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  confirmation_status text NOT NULL DEFAULT 'new',
  cancel_reason text,
  shipping_status text,
  delivery_status text DEFAULT 'pending',
  note text DEFAULT '',
  attempt_count integer NOT NULL DEFAULT 0,
  postpone_date timestamptz,
  source_sheet_id uuid,
  fragile boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  delivered_at timestamptz
);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access orders" ON public.orders FOR ALL
  TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Sellers can view own orders" ON public.orders FOR SELECT
  TO authenticated USING (auth.uid() = seller_id);

CREATE POLICY "Agents can view assigned orders" ON public.orders FOR SELECT
  TO authenticated USING (auth.uid() = agent_id);

CREATE POLICY "Agents can update assigned orders" ON public.orders FOR UPDATE
  TO authenticated USING (auth.uid() = agent_id);

CREATE INDEX idx_orders_seller_id ON public.orders (seller_id);
CREATE INDEX idx_orders_agent_id ON public.orders (agent_id);
CREATE INDEX idx_orders_status_created ON public.orders (confirmation_status, created_at DESC);
CREATE INDEX idx_orders_order_id_prefix ON public.orders (order_id text_pattern_ops);
CREATE INDEX idx_orders_delivery_status ON public.orders (delivery_status);
CREATE INDEX idx_orders_created_at ON public.orders (created_at DESC);

CREATE TABLE public.seller_order_prefixes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL UNIQUE,
  prefix text NOT NULL UNIQUE,
  current_counter integer NOT NULL DEFAULT 0
);

ALTER TABLE public.seller_order_prefixes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage prefixes" ON public.seller_order_prefixes FOR ALL
  TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.generate_order_id(p_seller_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_prefix text;
  v_counter integer;
BEGIN
  UPDATE seller_order_prefixes
  SET current_counter = current_counter + 1
  WHERE seller_id = p_seller_id
  RETURNING prefix, current_counter INTO v_prefix, v_counter;

  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'No prefix found for seller %', p_seller_id;
  END IF;

  RETURN v_prefix || '-' || LPAD(v_counter::text, 3, '0');
END;
$$;

CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
