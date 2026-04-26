-- Merge duplicate WhatsApp conversations per phone number.
-- Keep the OLDEST conversation per phone, move all messages to it,
-- then delete the duplicates.

WITH ranked AS (
  SELECT
    id,
    customer_phone,
    ROW_NUMBER() OVER (PARTITION BY customer_phone ORDER BY created_at ASC) AS rn,
    FIRST_VALUE(id) OVER (PARTITION BY customer_phone ORDER BY created_at ASC) AS keeper_id
  FROM public.whatsapp_conversations
),
duplicates AS (
  SELECT id AS dup_id, keeper_id
  FROM ranked
  WHERE rn > 1
)
-- 1) Re-point all messages from duplicate conversations to the keeper.
UPDATE public.whatsapp_messages m
SET conversation_id = d.keeper_id
FROM duplicates d
WHERE m.conversation_id = d.dup_id;

-- 2) Re-point AI memory rows if they reference a duplicate conversation.
WITH ranked AS (
  SELECT
    id,
    customer_phone,
    ROW_NUMBER() OVER (PARTITION BY customer_phone ORDER BY created_at ASC) AS rn,
    FIRST_VALUE(id) OVER (PARTITION BY customer_phone ORDER BY created_at ASC) AS keeper_id
  FROM public.whatsapp_conversations
),
duplicates AS (
  SELECT id AS dup_id, keeper_id
  FROM ranked
  WHERE rn > 1
)
UPDATE public.whatsapp_ai_memory am
SET conversation_id = d.keeper_id
FROM duplicates d
WHERE am.conversation_id = d.dup_id;

-- 3) For each keeper, refresh last_message_at / last_reply_at / updated_at
--    from the merged set of messages.
WITH ranked AS (
  SELECT
    id,
    customer_phone,
    ROW_NUMBER() OVER (PARTITION BY customer_phone ORDER BY created_at ASC) AS rn
  FROM public.whatsapp_conversations
),
keepers AS (
  SELECT id FROM ranked WHERE rn = 1
),
agg AS (
  SELECT
    m.conversation_id,
    MAX(m.created_at) AS last_msg,
    MAX(m.created_at) FILTER (WHERE m.direction = 'in') AS last_reply
  FROM public.whatsapp_messages m
  WHERE m.conversation_id IN (SELECT id FROM keepers)
  GROUP BY m.conversation_id
)
UPDATE public.whatsapp_conversations c
SET
  last_message_at = COALESCE(a.last_msg, c.last_message_at),
  last_reply_at   = COALESCE(a.last_reply, c.last_reply_at),
  updated_at      = now()
FROM agg a
WHERE c.id = a.conversation_id;

-- 4) Delete the now-empty duplicate conversations.
WITH ranked AS (
  SELECT
    id,
    customer_phone,
    ROW_NUMBER() OVER (PARTITION BY customer_phone ORDER BY created_at ASC) AS rn
  FROM public.whatsapp_conversations
)
DELETE FROM public.whatsapp_conversations
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 5) Add a partial unique index to prevent future duplicates of UNLINKED
--    conversations on the same phone (orders may legitimately have multiple
--    threads when products differ, so we only enforce uniqueness when
--    order_id IS NULL).
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_conversations_phone_unlinked_unique
  ON public.whatsapp_conversations (customer_phone)
  WHERE order_id IS NULL;