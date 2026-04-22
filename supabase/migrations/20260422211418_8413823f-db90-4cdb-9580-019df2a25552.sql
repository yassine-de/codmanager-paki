-- AI Settings (singleton)
CREATE TABLE IF NOT EXISTS public.whatsapp_ai_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  -- Behavior
  system_prompt text NOT NULL DEFAULT 'You are a professional WhatsApp sales and customer support agent for a Moroccan e-commerce store.

Your goal is to:
- Help customers understand products
- Answer questions clearly and politely
- Confirm orders and collect missing information (name, address, phone)
- Detect intent and respond accordingly',
  brand_tone text NOT NULL DEFAULT 'friendly',
  language_rules text NOT NULL DEFAULT 'Detect user language and reply in the same language (darija, arabic, french, english).',
  product_context text NOT NULL DEFAULT 'Always prioritize products from the database. If multiple products exist, suggest the most relevant or best-selling one.',
  model text NOT NULL DEFAULT 'google/gemini-2.5-flash',
  temperature numeric NOT NULL DEFAULT 0.7,
  confidence_threshold numeric NOT NULL DEFAULT 0.85,
  max_tokens integer NOT NULL DEFAULT 512,
  response_lines integer NOT NULL DEFAULT 3,
  -- Feature toggles
  suggested_replies_enabled boolean NOT NULL DEFAULT true,
  full_auto_reply_enabled boolean NOT NULL DEFAULT false,
  intent_detection_enabled boolean NOT NULL DEFAULT true,
  sentiment_analysis_enabled boolean NOT NULL DEFAULT true,
  lead_qualification_enabled boolean NOT NULL DEFAULT true,
  order_tracking_enabled boolean NOT NULL DEFAULT true,
  ai_memory_enabled boolean NOT NULL DEFAULT true,
  smart_follow_up_enabled boolean NOT NULL DEFAULT false,
  language_detection_enabled boolean NOT NULL DEFAULT true,
  ai_image_analysis_enabled boolean NOT NULL DEFAULT true,
  voice_transcription_enabled boolean NOT NULL DEFAULT true,
  ai_voice_response_enabled boolean NOT NULL DEFAULT false,
  -- Smart follow-up
  smart_follow_up_idle_hours integer NOT NULL DEFAULT 24,
  -- Misc
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.whatsapp_ai_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view AI settings"
  ON public.whatsapp_ai_settings FOR SELECT
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can insert AI settings"
  ON public.whatsapp_ai_settings FOR INSERT
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update AI settings"
  ON public.whatsapp_ai_settings FOR UPDATE
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can delete AI settings"
  ON public.whatsapp_ai_settings FOR DELETE
  USING (public.is_admin(auth.uid()));

INSERT INTO public.whatsapp_ai_settings (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

-- AI Memory per customer phone
CREATE TABLE IF NOT EXISTS public.whatsapp_ai_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_phone text NOT NULL,
  conversation_id uuid REFERENCES public.whatsapp_conversations(id) ON DELETE SET NULL,
  summary text,
  language text,
  sentiment text,
  intent text,
  lead_score integer DEFAULT 0,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_interaction_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_phone)
);

CREATE INDEX IF NOT EXISTS idx_ai_memory_phone ON public.whatsapp_ai_memory (customer_phone);

ALTER TABLE public.whatsapp_ai_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage AI memory"
  ON public.whatsapp_ai_memory FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- AI suggestions for inbox
CREATE TABLE IF NOT EXISTS public.whatsapp_ai_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.whatsapp_messages(id) ON DELETE CASCADE,
  suggestions jsonb NOT NULL DEFAULT '[]'::jsonb,
  intent text,
  sentiment text,
  language text,
  confidence numeric,
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_suggestions_conv ON public.whatsapp_ai_suggestions (conversation_id, created_at DESC);

ALTER TABLE public.whatsapp_ai_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage AI suggestions"
  ON public.whatsapp_ai_suggestions FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));