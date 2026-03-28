
CREATE TABLE public.rate_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid DEFAULT NULL,
  dropped_order_rate numeric NOT NULL DEFAULT 0,
  confirmed_order_rate numeric NOT NULL DEFAULT 0,
  shipping_rate_1kg numeric NOT NULL DEFAULT 0,
  shipping_rate_2kg numeric NOT NULL DEFAULT 0,
  shipping_rate_3kg numeric NOT NULL DEFAULT 0,
  cod_fee_per_delivery numeric NOT NULL DEFAULT 0,
  agent_commission_confirmed numeric NOT NULL DEFAULT 0,
  agent_commission_delivered numeric NOT NULL DEFAULT 0,
  is_global boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rate_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access rate_settings"
  ON public.rate_settings FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Sellers view own rate_settings"
  ON public.rate_settings FOR SELECT
  TO authenticated
  USING (seller_id = auth.uid() OR seller_id IS NULL);

CREATE TRIGGER update_rate_settings_updated_at
  BEFORE UPDATE ON public.rate_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
