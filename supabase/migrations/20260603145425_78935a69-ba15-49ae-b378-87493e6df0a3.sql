
-- ============= STORAGE: sourcing-images (ownership check) =============
DROP POLICY IF EXISTS "Authenticated users can upload sourcing images" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own sourcing images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own sourcing images" ON storage.objects;

CREATE POLICY "Sourcing images: owners or admins can upload"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'sourcing-images'
  AND (
    public.is_admin(auth.uid())
    OR (storage.foldername(name))[1] = auth.uid()::text
  )
);

CREATE POLICY "Sourcing images: owners or admins can update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'sourcing-images'
  AND (
    public.is_admin(auth.uid())
    OR (storage.foldername(name))[1] = auth.uid()::text
  )
)
WITH CHECK (
  bucket_id = 'sourcing-images'
  AND (
    public.is_admin(auth.uid())
    OR (storage.foldername(name))[1] = auth.uid()::text
  )
);

CREATE POLICY "Sourcing images: owners or admins can delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'sourcing-images'
  AND (
    public.is_admin(auth.uid())
    OR (storage.foldername(name))[1] = auth.uid()::text
  )
);

-- ============= STORAGE: whatsapp-media (restrict to staff roles) =============
DROP POLICY IF EXISTS "Authenticated can upload whatsapp media" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can update whatsapp media" ON storage.objects;

CREATE POLICY "WhatsApp media: staff can upload"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'whatsapp-media'
  AND (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'agent'::app_role)
    OR public.has_role(auth.uid(), 'follow_up'::app_role)
  )
);

CREATE POLICY "WhatsApp media: staff can update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'whatsapp-media'
  AND (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'agent'::app_role)
    OR public.has_role(auth.uid(), 'follow_up'::app_role)
  )
)
WITH CHECK (
  bucket_id = 'whatsapp-media'
  AND (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'agent'::app_role)
    OR public.has_role(auth.uid(), 'follow_up'::app_role)
  )
);

CREATE POLICY "WhatsApp media: staff can delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'whatsapp-media'
  AND (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'agent'::app_role)
    OR public.has_role(auth.uid(), 'follow_up'::app_role)
  )
);

-- ============= app_settings: restrict reads to admin + public-key whitelist =============
DROP POLICY IF EXISTS "Authenticated can read app_settings" ON public.app_settings;

CREATE POLICY "Authenticated can read public app_settings"
ON public.app_settings FOR SELECT TO authenticated
USING (
  public.is_admin(auth.uid())
  OR key IN (
    'google_service_account_email',
    'rates_mode',
    'agent_rates_mode',
    'follow_up_assignment_mode',
    'orio_api_enabled',
    'orio_sync_interval_minutes'
  )
);
