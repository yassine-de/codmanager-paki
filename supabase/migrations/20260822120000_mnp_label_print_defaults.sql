INSERT INTO public.app_settings (key, value, is_public, updated_at)
VALUES
  ('mnp_label_type', '3', false, now()),
  ('mnp_without_shipper_contact', 'true', false, now())
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  is_public = EXCLUDED.is_public,
  updated_at = now();
