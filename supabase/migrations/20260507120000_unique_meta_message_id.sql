-- Prevent duplicate processing of the same WhatsApp message.
-- Meta sometimes delivers the same webhook payload twice (retry after timeout).
-- A partial unique index (WHERE NOT NULL) blocks the second INSERT so the
-- webhook code can detect the duplicate and skip AI processing.

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_meta_message_id_unique
  ON public.whatsapp_messages (meta_message_id)
  WHERE meta_message_id IS NOT NULL;
