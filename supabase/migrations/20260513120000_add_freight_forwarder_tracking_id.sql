-- Add freight_forwarder and tracking_id to sourcing_requests (admin-only fields)
ALTER TABLE public.sourcing_requests
  ADD COLUMN IF NOT EXISTS freight_forwarder text,
  ADD COLUMN IF NOT EXISTS tracking_id text;

NOTIFY pgrst, 'reload schema';
