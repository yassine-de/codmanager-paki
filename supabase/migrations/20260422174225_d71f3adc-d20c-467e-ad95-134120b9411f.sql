
-- =========================================================================
-- WhatsApp Automation Module (additive only)
-- No changes to existing triggers, RPCs, or invoice logic.
-- =========================================================================

-- 1. Order columns -----------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS confirmation_channel text NOT NULL DEFAULT 'agent',
  ADD COLUMN IF NOT EXISTS whatsapp_status text,
  ADD COLUMN IF NOT EXISTS whatsapp_last_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_last_reply_at timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS whatsapp_note text;

-- 2. Product toggle ----------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS whatsapp_confirmation_enabled boolean NOT NULL DEFAULT false;

-- 3. Templates ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL DEFAULT 'first_message',
    -- first_message | reminder | more_info | cancel_recovery
  language text NOT NULL DEFAULT 'en',
  meta_template_name text,
  body text NOT NULL DEFAULT '',
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins full access whatsapp_templates"
  ON public.whatsapp_templates FOR ALL TO authenticated
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

-- 4. Conversations -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL,
  customer_phone text NOT NULL,
  customer_name text,
  status text NOT NULL DEFAULT 'pending',
    -- pending | awaiting_reply | confirmed | more_info | canceled | failed
  last_message_at timestamptz,
  last_reply_at timestamptz,
  outcome text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wts_conv_order ON public.whatsapp_conversations(order_id);
CREATE INDEX IF NOT EXISTS idx_wts_conv_phone ON public.whatsapp_conversations(customer_phone);
ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins full access whatsapp_conversations"
  ON public.whatsapp_conversations FOR ALL TO authenticated
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

-- 5. Messages ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  order_id text,
  direction text NOT NULL, -- 'out' | 'in'
  message_type text NOT NULL DEFAULT 'text', -- text | template | interactive | button_reply
  body text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  meta_message_id text,
  status text, -- sent | delivered | read | failed
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wts_msg_conv ON public.whatsapp_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_wts_msg_order ON public.whatsapp_messages(order_id);
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins full access whatsapp_messages"
  ON public.whatsapp_messages FOR ALL TO authenticated
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

-- 6. Settings (single row pattern via key/value) -----------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name text NOT NULL DEFAULT 'meta_cloud',
  api_base_url text NOT NULL DEFAULT 'https://graph.facebook.com/v21.0',
  phone_number_id text,
  waba_id text,
  sender_number text,
  webhook_secret text,
  default_country_code text NOT NULL DEFAULT '92',
  max_retries integer NOT NULL DEFAULT 2,
  integration_enabled boolean NOT NULL DEFAULT false,
  sending_enabled boolean NOT NULL DEFAULT false,
  receiving_enabled boolean NOT NULL DEFAULT false,
  auto_book_shipping boolean NOT NULL DEFAULT false,
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.whatsapp_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins full access whatsapp_settings"
  ON public.whatsapp_settings FOR ALL TO authenticated
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

-- Seed singleton row
INSERT INTO public.whatsapp_settings (singleton) VALUES (true)
  ON CONFLICT (singleton) DO NOTHING;

-- 7. updated_at triggers (reuse existing function) ---------------------------
CREATE TRIGGER trg_wts_templates_updated
  BEFORE UPDATE ON public.whatsapp_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_wts_conv_updated
  BEFORE UPDATE ON public.whatsapp_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_wts_settings_updated
  BEFORE UPDATE ON public.whatsapp_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
