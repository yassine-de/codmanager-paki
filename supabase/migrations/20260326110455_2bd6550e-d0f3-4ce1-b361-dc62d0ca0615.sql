
CREATE TABLE public.seller_payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  method text NOT NULL CHECK (method IN ('cih', 'binance')),
  is_default boolean NOT NULL DEFAULT false,
  cih_account_name text,
  cih_rib text,
  binance_id text,
  binance_wallet_address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, method)
);

ALTER TABLE public.seller_payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access seller_payment_methods"
  ON public.seller_payment_methods FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Sellers can manage own payment methods"
  ON public.seller_payment_methods FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_seller_payment_methods_updated_at
  BEFORE UPDATE ON public.seller_payment_methods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
