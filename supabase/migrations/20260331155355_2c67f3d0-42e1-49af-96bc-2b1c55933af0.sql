
-- Add ORIO shipping integration fields to orders table
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS orio_order_id integer,
  ADD COLUMN IF NOT EXISTS orio_consignment_no text,
  ADD COLUMN IF NOT EXISTS orio_shipping_status text,
  ADD COLUMN IF NOT EXISTS orio_sync_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS orio_sync_error text,
  ADD COLUMN IF NOT EXISTS orio_synced_at timestamp with time zone;

-- Create ORIO cities cache table
CREATE TABLE IF NOT EXISTS public.orio_cities_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id integer NOT NULL,
  city_name text NOT NULL,
  province_id integer,
  cached_at timestamp with time zone NOT NULL DEFAULT now()
);

-- RLS for orio_cities_cache (read-only for authenticated)
ALTER TABLE public.orio_cities_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read orio cities"
  ON public.orio_cities_cache FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins can manage orio cities"
  ON public.orio_cities_cache FOR ALL
  TO authenticated USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- Create ORIO platform cache table
CREATE TABLE IF NOT EXISTS public.orio_platform_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id integer NOT NULL DEFAULT 7,
  customer_platform_id integer NOT NULL,
  cached_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.orio_platform_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read orio platform"
  ON public.orio_platform_cache FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins can manage orio platform"
  ON public.orio_platform_cache FOR ALL
  TO authenticated USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));
