
ALTER TABLE public.whatsapp_templates
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'UTILITY',
  ADD COLUMN IF NOT EXISTS header_type text DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS header_text text,
  ADD COLUMN IF NOT EXISTS header_media_url text,
  ADD COLUMN IF NOT EXISTS footer text,
  ADD COLUMN IF NOT EXISTS buttons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'LOCAL',
  ADD COLUMN IF NOT EXISTS meta_template_id text,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

COMMENT ON COLUMN public.whatsapp_templates.sync_status IS 'LOCAL | PENDING | APPROVED | REJECTED | PAUSED | DISABLED';
COMMENT ON COLUMN public.whatsapp_templates.category IS 'UTILITY | MARKETING | AUTHENTICATION';
COMMENT ON COLUMN public.whatsapp_templates.header_type IS 'NONE | TEXT | IMAGE | VIDEO | DOCUMENT';
