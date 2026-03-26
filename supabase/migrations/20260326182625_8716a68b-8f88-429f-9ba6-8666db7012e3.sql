-- Add last_imported_row to track import position
ALTER TABLE public.integration_sheets ADD COLUMN IF NOT EXISTS last_imported_row integer NOT NULL DEFAULT 1;

-- Create app_settings table for global admin settings
CREATE TABLE IF NOT EXISTS public.app_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access app_settings"
  ON public.app_settings FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Authenticated can read app_settings"
  ON public.app_settings FOR SELECT
  TO authenticated
  USING (true);

-- Allow sellers to INSERT their own sheets
CREATE POLICY "Sellers can insert own sheets"
  ON public.integration_sheets FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = seller_id);

-- Allow sellers to UPDATE their own sheets
CREATE POLICY "Sellers can update own sheets"
  ON public.integration_sheets FOR UPDATE
  TO authenticated
  USING (auth.uid() = seller_id);

-- Allow sellers to DELETE their own sheets
CREATE POLICY "Sellers can delete own sheets"
  ON public.integration_sheets FOR DELETE
  TO authenticated
  USING (auth.uid() = seller_id);