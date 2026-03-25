-- Add new pricing columns and product image
ALTER TABLE public.sourcing_requests
  ADD COLUMN IF NOT EXISTS landed_price numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seller_price numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS product_image_url text DEFAULT '';

-- Create storage bucket for sourcing images
INSERT INTO storage.buckets (id, name, public)
VALUES ('sourcing-images', 'sourcing-images', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to sourcing-images
CREATE POLICY "Authenticated users can upload sourcing images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'sourcing-images');

-- Allow public read access
CREATE POLICY "Public read access for sourcing images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'sourcing-images');

-- Allow users to update their own sourcing images
CREATE POLICY "Users can update own sourcing images"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'sourcing-images');

-- Allow users to delete own sourcing images
CREATE POLICY "Users can delete own sourcing images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'sourcing-images');