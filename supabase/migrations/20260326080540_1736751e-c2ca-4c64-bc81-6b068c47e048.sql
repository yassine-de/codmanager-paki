
-- Add weight to orders
ALTER TABLE orders ADD COLUMN weight numeric DEFAULT 0;

-- Create invoice number sequence
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;

-- Create invoices table
CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL,
  invoice_number text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz DEFAULT now(),
  finalized_at timestamptz,
  paid_at timestamptz,
  paid_by text,
  payment_proof_url text
);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access invoices" ON invoices FOR ALL TO authenticated
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Sellers view own invoices" ON invoices FOR SELECT TO authenticated
  USING (auth.uid() = seller_id);

-- Add invoice_id to orders
ALTER TABLE orders ADD COLUMN invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL;

-- Create invoice_addons table
CREATE TABLE invoice_addons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'in',
  amount numeric NOT NULL DEFAULT 0,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE invoice_addons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access invoice_addons" ON invoice_addons FOR ALL TO authenticated
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Sellers view own addons" ON invoice_addons FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM invoices WHERE invoices.id = invoice_addons.invoice_id AND invoices.seller_id = auth.uid()));

-- Auto-generate invoice number trigger
CREATE OR REPLACE FUNCTION set_invoice_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.invoice_number = '' OR NEW.invoice_number IS NULL THEN
    NEW.invoice_number = 'INV-' || LPAD(nextval('invoice_number_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_invoice_number_trigger
BEFORE INSERT ON invoices
FOR EACH ROW
EXECUTE FUNCTION set_invoice_number();
