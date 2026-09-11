-- Track which staff member sent an outbound WhatsApp message, so "Replies
-- by Agent" reporting can attribute manual replies to a real person.
-- NULL for internal/automation/campaign sends (isInternalCall in
-- whatsapp-send), which aren't a human agent's reply.
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_sent_by_created_at
  ON public.whatsapp_messages (sent_by, created_at)
  WHERE sent_by IS NOT NULL;
