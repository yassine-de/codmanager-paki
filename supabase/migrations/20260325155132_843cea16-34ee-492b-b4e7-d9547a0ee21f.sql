
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS video_url text DEFAULT '',
  ADD COLUMN IF NOT EXISTS seller_seen boolean DEFAULT false;
