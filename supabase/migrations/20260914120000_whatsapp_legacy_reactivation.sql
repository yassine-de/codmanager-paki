-- Fix: a conversation was only ever frozen into is_legacy=true at the
-- one-time cutover (20260914090000). If a customer's FIRST message was on
-- the old (disabled) WhatsApp number but their LATEST message came in on
-- the new number, the conversation must show as active/new, not old — the
-- inbox should reflect "where is this conversation now", not "where did it
-- start". Backfill any conversation that already has a real (non-note)
-- message after the new-number connection time, then keep it correct going
-- forward with a trigger, without touching whatsapp-webhook/whatsapp-send.

DO $$
DECLARE
  cutover timestamptz;
BEGIN
  SELECT updated_at INTO cutover FROM public.whatsapp_settings ORDER BY updated_at DESC LIMIT 1;

  IF cutover IS NOT NULL THEN
    UPDATE public.whatsapp_conversations c
    SET is_legacy = false
    WHERE c.is_legacy = true
      AND EXISTS (
        SELECT 1 FROM public.whatsapp_messages m
        WHERE m.conversation_id = c.id
          AND m.created_at > cutover
          AND m.message_type <> 'note'
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.mark_conversation_active_on_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.whatsapp_conversations
  SET is_legacy = false
  WHERE id = NEW.conversation_id AND is_legacy = true;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_whatsapp_message_unlegacy ON public.whatsapp_messages;
CREATE TRIGGER trg_whatsapp_message_unlegacy
AFTER INSERT ON public.whatsapp_messages
FOR EACH ROW
WHEN (NEW.message_type IS DISTINCT FROM 'note')
EXECUTE FUNCTION public.mark_conversation_active_on_new_message();
