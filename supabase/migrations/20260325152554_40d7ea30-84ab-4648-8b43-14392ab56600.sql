ALTER TABLE public.sourcing_requests
  ADD COLUMN IF NOT EXISTS seller_seen boolean DEFAULT true;