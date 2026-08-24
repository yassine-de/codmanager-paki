CREATE TABLE IF NOT EXISTS public.carrier_city_unmatched (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id uuid NOT NULL REFERENCES public.carriers(id) ON DELETE CASCADE,
  fallback_carrier_id uuid REFERENCES public.carriers(id) ON DELETE SET NULL,
  input_city text NOT NULL,
  normalized_city text NOT NULL,
  reason text,
  last_order_uuid uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  last_order_id text,
  last_system_id bigint,
  occurrence_count integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'open',
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (carrier_id, normalized_city)
);

CREATE INDEX IF NOT EXISTS idx_carrier_city_unmatched_status_seen
  ON public.carrier_city_unmatched(status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_carrier_city_unmatched_carrier
  ON public.carrier_city_unmatched(carrier_id, status, last_seen_at DESC);

ALTER TABLE public.carrier_city_unmatched ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'carrier_city_unmatched'
      AND policyname = 'Staff manage carrier city unmatched'
  ) THEN
    CREATE POLICY "Staff manage carrier city unmatched"
      ON public.carrier_city_unmatched
      FOR ALL
      TO authenticated
      USING (public.is_staff(auth.uid()))
      WITH CHECK (public.is_staff(auth.uid()));
  END IF;
END $$;

UPDATE public.carrier_city_cache
SET aliases = (
  SELECT jsonb_agg(DISTINCT alias_value)
  FROM jsonb_array_elements_text(
    COALESCE(aliases, '[]'::jsonb) || '["SARGODHA"]'::jsonb
  ) AS alias_value
)
WHERE lower(city_name) = 'sargodah'
  AND NOT (COALESCE(aliases, '[]'::jsonb) ? 'SARGODHA');
