-- Add last_inbound_at to whatsapp_conversations
-- This column tracks when the last INBOUND (customer) message arrived.
-- Used for unread badge calculation: unread = last_inbound_at > last_read_at
-- (avoids a heavy per-conversation messages query in the inbox frontend)

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;

-- Back-fill: set last_inbound_at = max(created_at) for inbound messages per conversation
UPDATE public.whatsapp_conversations wc
SET last_inbound_at = sub.max_at
FROM (
  SELECT conversation_id, MAX(created_at) AS max_at
  FROM public.whatsapp_messages
  WHERE direction = 'in'
  GROUP BY conversation_id
) sub
WHERE wc.id = sub.conversation_id;
