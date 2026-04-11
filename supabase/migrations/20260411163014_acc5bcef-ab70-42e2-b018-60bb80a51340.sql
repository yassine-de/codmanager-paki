CREATE TABLE public.sourcing_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sourcing_request_id uuid NOT NULL,
  field_changed text NOT NULL,
  old_value text,
  new_value text,
  changed_by uuid NOT NULL,
  action_type text NOT NULL DEFAULT 'status_change',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sourcing_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access sourcing_history"
  ON public.sourcing_history FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

CREATE INDEX idx_sourcing_history_request ON public.sourcing_history(sourcing_request_id);
CREATE INDEX idx_sourcing_history_created ON public.sourcing_history(created_at DESC);