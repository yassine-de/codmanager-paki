-- Merge duplicate WhatsApp conversation for AB-263 customer (+923233320960).
-- Move messages from the orphan conv (created via webhook with "+" prefix)
-- to the original conv linked to order AB-263, then delete the duplicate.
UPDATE public.whatsapp_messages
SET conversation_id = '157429db-7262-408f-9abe-3d7e4af27e14',
    order_id = COALESCE(order_id, 'AB-263')
WHERE conversation_id = '033422fd-0d17-444a-9c5d-bbd04dc157fb';

-- Refresh the original conversation's last_message_at / status to reflect the inbound reply
UPDATE public.whatsapp_conversations
SET last_message_at = now(),
    last_reply_at = now(),
    updated_at = now(),
    status = 'manual_review_needed'
WHERE id = '157429db-7262-408f-9abe-3d7e4af27e14';

-- Remove the duplicate (now empty) conversation
DELETE FROM public.whatsapp_conversations
WHERE id = '033422fd-0d17-444a-9c5d-bbd04dc157fb';

-- Normalize phone storage on the surviving conversation to digits-only
UPDATE public.whatsapp_conversations
SET customer_phone = regexp_replace(customer_phone, '\D', '', 'g')
WHERE customer_phone ~ '\D';