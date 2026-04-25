
-- Campaigns table
CREATE TABLE public.whatsapp_campaigns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft', -- draft, scheduled, sending, completed, failed, cancelled
  template_id UUID REFERENCES public.whatsapp_templates(id) ON DELETE SET NULL,
  template_name TEXT, -- snapshot
  filters JSONB NOT NULL DEFAULT '{}'::jsonb, -- {seller_ids: [], cities: [], date_from, date_to, confirmation_status: [], delivery_status: [], product_ids: []}
  audience_source TEXT NOT NULL DEFAULT 'orders', -- orders | conversations
  send_mode TEXT NOT NULL DEFAULT 'immediate', -- immediate | scheduled
  scheduled_at TIMESTAMP WITH TIME ZONE,
  throttle_per_minute INTEGER NOT NULL DEFAULT 30,
  total_recipients INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  read_count INTEGER NOT NULL DEFAULT 0,
  replied_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_wts_campaigns_status ON public.whatsapp_campaigns(status);
CREATE INDEX idx_wts_campaigns_scheduled ON public.whatsapp_campaigns(scheduled_at) WHERE status = 'scheduled';

ALTER TABLE public.whatsapp_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access whatsapp_campaigns"
ON public.whatsapp_campaigns
FOR ALL
TO authenticated
USING (is_admin(auth.uid()))
WITH CHECK (is_admin(auth.uid()));

CREATE TRIGGER trg_wts_campaigns_updated
BEFORE UPDATE ON public.whatsapp_campaigns
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Recipients table
CREATE TABLE public.whatsapp_campaign_recipients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.whatsapp_campaigns(id) ON DELETE CASCADE,
  order_id TEXT,
  customer_phone TEXT NOT NULL,
  customer_name TEXT,
  variables JSONB NOT NULL DEFAULT '{}'::jsonb, -- snapshot to render template
  status TEXT NOT NULL DEFAULT 'pending', -- pending | sent | delivered | read | replied | failed
  message_id UUID REFERENCES public.whatsapp_messages(id) ON DELETE SET NULL,
  meta_message_id TEXT,
  conversation_id UUID,
  error_message TEXT,
  sent_at TIMESTAMP WITH TIME ZONE,
  delivered_at TIMESTAMP WITH TIME ZONE,
  read_at TIMESTAMP WITH TIME ZONE,
  replied_at TIMESTAMP WITH TIME ZONE,
  failed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_wts_camp_recip_campaign ON public.whatsapp_campaign_recipients(campaign_id);
CREATE INDEX idx_wts_camp_recip_status ON public.whatsapp_campaign_recipients(campaign_id, status);
CREATE INDEX idx_wts_camp_recip_meta ON public.whatsapp_campaign_recipients(meta_message_id) WHERE meta_message_id IS NOT NULL;

ALTER TABLE public.whatsapp_campaign_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access whatsapp_campaign_recipients"
ON public.whatsapp_campaign_recipients
FOR ALL
TO authenticated
USING (is_admin(auth.uid()))
WITH CHECK (is_admin(auth.uid()));

ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_campaigns;
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_campaign_recipients;
