-- Legacy WhatsApp/app compatibility layer.
-- Keeps the new scalable schema, while preserving the old WhatsApp module shape.

-- ---------------------------------------------------------------------------
-- App settings and permissions used by legacy UI/Edge Functions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value text,
  is_public boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.permissions (
  key text PRIMARY KEY,
  label text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES public.permissions(key) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, permission_key)
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff manage app_settings" ON public.app_settings;
CREATE POLICY "Staff manage app_settings"
  ON public.app_settings FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "Authenticated read public app_settings" ON public.app_settings;
CREATE POLICY "Authenticated read public app_settings"
  ON public.app_settings FOR SELECT TO authenticated
  USING (is_public OR public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "Authenticated read permissions" ON public.permissions;
CREATE POLICY "Authenticated read permissions"
  ON public.permissions FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins manage permissions" ON public.permissions;
CREATE POLICY "Admins manage permissions"
  ON public.permissions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users read own permissions" ON public.user_permissions;
CREATE POLICY "Users read own permissions"
  ON public.user_permissions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins manage user_permissions" ON public.user_permissions;
CREATE POLICY "Admins manage user_permissions"
  ON public.user_permissions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.permissions (key, label, category)
VALUES
  ('access_to_dashboard', 'Access dashboard', 'dashboard'),
  ('view_dashboard', 'View dashboard', 'dashboard'),
  ('access_to_orders', 'Access orders', 'orders'),
  ('view_order', 'View orders', 'orders'),
  ('create_order', 'Create orders', 'orders'),
  ('update_order', 'Update orders', 'orders'),
  ('show_all_orders', 'Show all orders', 'orders'),
  ('access_to_products', 'Access products', 'products'),
  ('view_product', 'View products', 'products'),
  ('create_product', 'Create products', 'products'),
  ('update_product', 'Update products', 'products'),
  ('show_all_products', 'Show all products', 'products'),
  ('access_to_confirmations', 'Access confirmations', 'confirmations'),
  ('view_confirmation', 'View confirmations', 'confirmations'),
  ('create_confirmation', 'Create confirmations', 'confirmations'),
  ('update_confirmation', 'Update confirmations', 'confirmations'),
  ('show_all_confirmations', 'Show all confirmations', 'confirmations'),
  ('access_to_whatsapp', 'Access WhatsApp', 'whatsapp'),
  ('manage_whatsapp', 'Manage WhatsApp', 'whatsapp'),
  ('access_to_fulfillment', 'Access fulfillment', 'fulfillment'),
  ('scan_shipments', 'Scan shipments', 'fulfillment'),
  ('manage_inventory', 'Manage inventory', 'inventory')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_settings (key, value, is_public, updated_at)
VALUES
  ('project_url', 'https://miyzjhjcyowkttdszxit.supabase.co', true, now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, is_public = EXCLUDED.is_public, updated_at = now();

-- ---------------------------------------------------------------------------
-- Legacy columns expected by existing WhatsApp/settings UI
-- ---------------------------------------------------------------------------

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS confirmation_channel text NOT NULL DEFAULT 'agent',
  ADD COLUMN IF NOT EXISTS whatsapp_status text,
  ADD COLUMN IF NOT EXISTS whatsapp_last_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_last_reply_at timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS whatsapp_note text;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS whatsapp_confirmation_enabled boolean NOT NULL DEFAULT false;

-- Existing new schema used order_id UUID for WhatsApp. Preserve it as order_uuid
-- and restore legacy order_id text used by old Edge Functions and UI.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_conversations'
      AND column_name = 'order_id' AND data_type = 'uuid'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_conversations'
      AND column_name = 'order_uuid'
  ) THEN
    ALTER TABLE public.whatsapp_conversations RENAME COLUMN order_id TO order_uuid;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_messages'
      AND column_name = 'order_id' AND data_type = 'uuid'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_messages'
      AND column_name = 'order_uuid'
  ) THEN
    ALTER TABLE public.whatsapp_messages RENAME COLUMN order_id TO order_uuid;
  END IF;
END $$;

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS order_id text,
  ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS resolved_by uuid,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS order_id text;

CREATE INDEX IF NOT EXISTS idx_wts_conv_order_text ON public.whatsapp_conversations(order_id);
CREATE INDEX IF NOT EXISTS idx_wts_conv_phone_text ON public.whatsapp_conversations(customer_phone);
CREATE INDEX IF NOT EXISTS idx_wts_msg_order_text ON public.whatsapp_messages(order_id);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_meta_message_id_unique
  ON public.whatsapp_messages(meta_message_id)
  WHERE meta_message_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- WhatsApp settings/templates/campaigns/automations/AI
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.whatsapp_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name text NOT NULL DEFAULT 'meta_cloud',
  api_base_url text NOT NULL DEFAULT 'https://graph.facebook.com/v21.0',
  phone_number_id text,
  waba_id text,
  sender_number text,
  webhook_secret text,
  access_token text,
  default_country_code text NOT NULL DEFAULT '92',
  max_retries integer NOT NULL DEFAULT 2,
  integration_enabled boolean NOT NULL DEFAULT false,
  sending_enabled boolean NOT NULL DEFAULT true,
  receiving_enabled boolean NOT NULL DEFAULT false,
  auto_book_shipping boolean NOT NULL DEFAULT false,
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL DEFAULT 'first_message',
  language text NOT NULL DEFAULT 'en',
  meta_template_name text,
  body text NOT NULL DEFAULT '',
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  category text NOT NULL DEFAULT 'UTILITY',
  header_type text DEFAULT 'NONE',
  header_text text,
  header_media_url text,
  footer text,
  buttons jsonb NOT NULL DEFAULT '[]'::jsonb,
  sync_status text NOT NULL DEFAULT 'LOCAL',
  meta_template_id text,
  rejection_reason text,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'Untitled',
  description text,
  status text NOT NULL DEFAULT 'draft',
  trigger_type text NOT NULL,
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  nodes jsonb NOT NULL DEFAULT '[]'::jsonb,
  edges jsonb NOT NULL DEFAULT '[]'::jsonb,
  runs_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  last_run_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid NOT NULL REFERENCES public.whatsapp_automations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  trigger_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  steps_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_message text,
  customer_phone text,
  order_id text,
  conversation_id uuid,
  current_node_id text,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  wait_until timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.whatsapp_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  template_id uuid REFERENCES public.whatsapp_templates(id) ON DELETE SET NULL,
  template_name text,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  audience_source text NOT NULL DEFAULT 'orders',
  send_mode text NOT NULL DEFAULT 'immediate',
  scheduled_at timestamptz,
  throttle_per_minute integer NOT NULL DEFAULT 30,
  total_recipients integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  delivered_count integer NOT NULL DEFAULT 0,
  read_count integer NOT NULL DEFAULT 0,
  replied_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.whatsapp_campaigns(id) ON DELETE CASCADE,
  order_id text,
  customer_phone text NOT NULL,
  customer_name text,
  variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  message_id uuid REFERENCES public.whatsapp_messages(id) ON DELETE SET NULL,
  meta_message_id text,
  conversation_id uuid,
  error_message text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  replied_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_ai_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  system_prompt text NOT NULL DEFAULT 'You are a professional WhatsApp sales and customer support agent.',
  brand_tone text NOT NULL DEFAULT 'friendly',
  language_rules text NOT NULL DEFAULT 'Detect user language and reply in the same language.',
  product_context text NOT NULL DEFAULT 'Prioritize products from the database.',
  model text NOT NULL DEFAULT 'google/gemini-2.5-flash',
  temperature numeric NOT NULL DEFAULT 0.7,
  confidence_threshold numeric NOT NULL DEFAULT 0.85,
  max_tokens integer NOT NULL DEFAULT 512,
  response_lines integer NOT NULL DEFAULT 3,
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
  smart_follow_up_idle_hours integer NOT NULL DEFAULT 24,
  ai_batch_wait_seconds integer NOT NULL DEFAULT 20,
  ai_dedup_window_seconds integer NOT NULL DEFAULT 30,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

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

INSERT INTO public.whatsapp_settings (singleton) VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

INSERT INTO public.whatsapp_ai_settings (singleton) VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_whatsapp_automations_status ON public.whatsapp_automations(status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_automations_trigger ON public.whatsapp_automations(trigger_type);
CREATE INDEX IF NOT EXISTS idx_automation_runs_automation ON public.whatsapp_automation_runs(automation_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_runs_status ON public.whatsapp_automation_runs(status);
CREATE INDEX IF NOT EXISTS whatsapp_automation_runs_status_wait_idx ON public.whatsapp_automation_runs(status, wait_until);
CREATE INDEX IF NOT EXISTS whatsapp_automation_runs_conv_status_idx ON public.whatsapp_automation_runs(conversation_id, status);
CREATE INDEX IF NOT EXISTS whatsapp_automation_runs_order_status_idx ON public.whatsapp_automation_runs(order_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_automation_runs_dedup_idx
  ON public.whatsapp_automation_runs(automation_id, order_id)
  WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wts_campaigns_status ON public.whatsapp_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_wts_campaigns_scheduled ON public.whatsapp_campaigns(scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_wts_camp_recip_campaign ON public.whatsapp_campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_wts_camp_recip_status ON public.whatsapp_campaign_recipients(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_wts_camp_recip_meta ON public.whatsapp_campaign_recipients(meta_message_id) WHERE meta_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_memory_phone ON public.whatsapp_ai_memory(customer_phone);
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_conv ON public.whatsapp_ai_suggestions(conversation_id, created_at DESC);

ALTER TABLE public.whatsapp_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_ai_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_ai_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_ai_suggestions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'whatsapp_settings','whatsapp_templates','whatsapp_automations',
    'whatsapp_automation_runs','whatsapp_campaigns','whatsapp_campaign_recipients',
    'whatsapp_ai_settings','whatsapp_ai_memory','whatsapp_ai_suggestions'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Staff manage ' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()))',
      'Staff manage ' || t,
      t
    );
  END LOOP;
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'whatsapp_settings','whatsapp_templates','whatsapp_automations',
    'whatsapp_campaigns','whatsapp_ai_settings','whatsapp_ai_memory'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = t || '_set_updated_at'
    ) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t || '_set_updated_at', t);
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.whatsapp_conversations REPLICA IDENTITY FULL;
ALTER TABLE public.whatsapp_messages REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_conversations;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_campaigns;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_campaign_recipients;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

NOTIFY pgrst, 'reload schema';
