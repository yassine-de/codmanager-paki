-- Add WhatsApp Inbox permission for agents
INSERT INTO public.permissions (key, label, description)
VALUES (
  'access_to_whatsapp_inbox',
  'WhatsApp Inbox',
  'Allows access to the WhatsApp inbox to view and reply to conversations'
)
ON CONFLICT (key) DO NOTHING;
