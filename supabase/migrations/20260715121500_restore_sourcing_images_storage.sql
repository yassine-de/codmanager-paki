-- Restore the public bucket used by sourcing request images.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'sourcing-images',
  'sourcing-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Public read sourcing images'
  ) THEN
    CREATE POLICY "Public read sourcing images"
    ON storage.objects
    FOR SELECT
    TO public
    USING (bucket_id = 'sourcing-images');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Authenticated upload sourcing images'
  ) THEN
    CREATE POLICY "Authenticated upload sourcing images"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'sourcing-images' AND owner = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Users update own sourcing images'
  ) THEN
    CREATE POLICY "Users update own sourcing images"
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (bucket_id = 'sourcing-images' AND owner = auth.uid())
    WITH CHECK (bucket_id = 'sourcing-images' AND owner = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Users delete own sourcing images'
  ) THEN
    CREATE POLICY "Users delete own sourcing images"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (bucket_id = 'sourcing-images' AND owner = auth.uid());
  END IF;
END $$;
