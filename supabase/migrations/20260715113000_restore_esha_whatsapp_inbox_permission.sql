-- Restore the legacy WhatsApp Inbox permission used by the agent inbox UI.
INSERT INTO public.permissions (key, label, category)
VALUES ('access_to_whatsapp_inbox', 'WhatsApp Inbox', 'whatsapp')
ON CONFLICT (key) DO UPDATE
SET label = EXCLUDED.label,
    category = EXCLUDED.category;

-- If Esha already exists in auth/profiles, grant the inbox permission without
-- creating a new user or replacing any existing permissions.
WITH esha_users AS (
  SELECT u.id AS user_id
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
  WHERE lower(u.email) = 'eshaehsan@gmail.com'
     OR lower(p.email) = 'eshaehsan@gmail.com'
)
INSERT INTO public.user_permissions (user_id, permission_key)
SELECT user_id, 'access_to_whatsapp_inbox'
FROM esha_users
ON CONFLICT (user_id, permission_key) DO NOTHING;
