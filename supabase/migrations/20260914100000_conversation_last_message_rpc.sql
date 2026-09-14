-- Read-only helper so the Inbox conversation list can show a real message
-- preview (like WhatsApp itself does) instead of the order id. Deliberately
-- NOT touching whatsapp-webhook/whatsapp-send to keep this cache in sync via
-- triggers on every insert — that function is the live AI/automation path,
-- and this is purely cosmetic; a read-time query carries zero risk to it.
-- Notes (message_type='note') are internal-only and excluded — a real
-- WhatsApp preview never shows a CRM note.
CREATE OR REPLACE FUNCTION public.get_conversation_last_messages()
RETURNS TABLE(conversation_id uuid, direction text, message_type text, body text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (m.conversation_id)
    m.conversation_id, m.direction, m.message_type, m.body, m.created_at
  FROM public.whatsapp_messages m
  WHERE m.message_type <> 'note'
    AND public.is_staff(auth.uid())
  ORDER BY m.conversation_id, m.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_conversation_last_messages() TO authenticated;
