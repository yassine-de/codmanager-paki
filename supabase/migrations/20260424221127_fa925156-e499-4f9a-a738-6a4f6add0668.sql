ALTER TABLE public.whatsapp_ai_settings
  ADD COLUMN IF NOT EXISTS ai_batch_wait_seconds integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS ai_dedup_window_seconds integer NOT NULL DEFAULT 30;