UPDATE public.orders
SET confirmation_status='confirmed',
    confirmation_channel='whatsapp',
    confirmed_at=COALESCE(confirmed_at, now()),
    whatsapp_status='confirmed'
WHERE order_id='AB-363' AND confirmation_status='new';

UPDATE public.whatsapp_conversations
SET status='confirmed', outcome='confirmed', pending_button_intent=NULL, updated_at=now()
WHERE id='4dcf2de7-2742-4086-8c55-34dc037b25af';

INSERT INTO public.order_history (order_id, changed_by, changed_by_role, action_type, field_changed, old_value, new_value, group_id)
VALUES
  ('AB-363','00000000-0000-0000-0000-000000000000','ai','ai_confirm','confirmation_status','new','confirmed', gen_random_uuid()::text),
  ('AB-363','00000000-0000-0000-0000-000000000000','ai','ai_confirm','confirmation_channel','agent','whatsapp', gen_random_uuid()::text);