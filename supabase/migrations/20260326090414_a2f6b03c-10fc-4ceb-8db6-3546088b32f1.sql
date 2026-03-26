
-- Table to track invoice-level events: status changes + order movements
CREATE TABLE public.invoice_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  event_type text NOT NULL DEFAULT 'status_change',
  field_changed text,
  old_value text,
  new_value text,
  order_id text,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.invoice_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access invoice_history"
ON public.invoice_history FOR ALL TO authenticated
USING (is_admin(auth.uid()))
WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Sellers view own invoice history"
ON public.invoice_history FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM invoices WHERE invoices.id = invoice_history.invoice_id AND invoices.seller_id = auth.uid()
));
