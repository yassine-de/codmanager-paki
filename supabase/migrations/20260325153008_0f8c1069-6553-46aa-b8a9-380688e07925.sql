ALTER TABLE public.sourcing_requests
  ADD COLUMN IF NOT EXISTS admin_seen boolean DEFAULT true;