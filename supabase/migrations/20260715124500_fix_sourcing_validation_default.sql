ALTER TABLE public.sourcing_requests
  ALTER COLUMN seller_validated DROP DEFAULT;

UPDATE public.sourcing_requests
SET seller_validated = NULL,
    updated_at = now()
WHERE status = 'waiting_quote'
  AND seller_validated = false;
