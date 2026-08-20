-- The WhatsApp AI bot kept auto-replying with generic filler ("Enjoy your
-- day!", "I'm not a robot...") to customers whose order was already
-- confirmed with a deliverable address on file. The three code paths in
-- supabase/functions/whatsapp-webhook/index.ts that confirm an order via
-- WhatsApp (button-confirm with stored address, stored-address shortcut,
-- and the final AI address-extract confirm) now set ai_enabled=false on
-- the conversation once confirmed, since there's nothing left for the AI
-- to do. This is a one-time backfill for conversations that already
-- reached that state before the code fix landed, so existing customers
-- stop getting bot replies immediately rather than waiting for their next
-- webhook event to happen to touch ai_enabled again.

UPDATE public.whatsapp_conversations wc
SET ai_enabled = false
FROM public.orders o
WHERE o.order_id = wc.order_id
  AND wc.status = 'confirmed'
  AND wc.ai_enabled = true
  AND o.confirmation_status = 'confirmed'
  AND o.customer_address IS NOT NULL
  AND length(trim(o.customer_address)) >= 10;
