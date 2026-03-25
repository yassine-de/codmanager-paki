
-- Integration sheets table
CREATE TABLE public.integration_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL,
  name text NOT NULL,
  sheet_name text NOT NULL DEFAULT '',
  sheet_url text NOT NULL DEFAULT '',
  orders_count integer NOT NULL DEFAULT 0,
  errors_count integer NOT NULL DEFAULT 0,
  last_check timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Integration errors table
CREATE TABLE public.integration_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id uuid NOT NULL REFERENCES public.integration_sheets(id) ON DELETE CASCADE,
  order_data jsonb DEFAULT '{}',
  error_message text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.integration_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_errors ENABLE ROW LEVEL SECURITY;

-- RLS policies for integration_sheets
CREATE POLICY "Admins can manage integration sheets"
  ON public.integration_sheets FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Sellers can view own sheets"
  ON public.integration_sheets FOR SELECT TO authenticated
  USING (auth.uid() = seller_id);

-- RLS policies for integration_errors
CREATE POLICY "Admins can manage integration errors"
  ON public.integration_errors FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Sellers can view own sheet errors"
  ON public.integration_errors FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.integration_sheets
      WHERE integration_sheets.id = integration_errors.sheet_id
      AND integration_sheets.seller_id = auth.uid()
    )
  );

-- Trigger for updated_at
CREATE TRIGGER update_integration_sheets_updated_at
  BEFORE UPDATE ON public.integration_sheets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
