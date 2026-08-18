-- Fixes duplicate whatsapp_conversations rows for the same order (e.g.
-- SU-349): whatsapp-webhook and whatsapp-automation-runner both do a
-- "find conversation by order_id, else create one" with no uniqueness
-- guard, so two near-simultaneous invocations (an inbound message arriving
-- right as an automated message goes out) can both miss the SELECT and
-- both INSERT, splitting the thread across two conversation ids. Verified
-- against live data: 12 orders affected, one-time.
--
-- Merge policy: keep the conversation with the most whatsapp_messages
-- (the "real" thread), tie-broken by latest last_message_at then oldest
-- created_at. Re-point every child row (messages, ai_suggestions,
-- automation_runs, campaign_recipients, ai_memory) from the loser to the
-- keeper, delete the loser, then add a unique index so this can't recur.
-- Dry-run confirmed zero message loss (14311 before/after) and zero
-- orphaned rows before this was applied for real.

DO $$
BEGIN
  CREATE TEMP TABLE _dup_conv_keeper AS
  WITH dupes AS (
    SELECT order_id FROM public.whatsapp_conversations
    WHERE order_id IS NOT NULL GROUP BY order_id HAVING count(*) > 1
  ),
  ranked AS (
    SELECT c.id, c.order_id,
      (SELECT count(*) FROM public.whatsapp_messages m WHERE m.conversation_id = c.id) AS msg_count,
      c.last_message_at, c.created_at,
      row_number() OVER (
        PARTITION BY c.order_id
        ORDER BY (SELECT count(*) FROM public.whatsapp_messages m WHERE m.conversation_id = c.id) DESC,
                 c.last_message_at DESC NULLS LAST, c.created_at ASC
      ) AS rn
    FROM public.whatsapp_conversations c JOIN dupes d ON d.order_id = c.order_id
  )
  SELECT order_id, id AS keeper_id FROM ranked WHERE rn = 1;

  UPDATE public.whatsapp_messages m SET conversation_id = k.keeper_id
  FROM public.whatsapp_conversations c JOIN _dup_conv_keeper k ON k.order_id = c.order_id
  WHERE m.conversation_id = c.id AND c.id <> k.keeper_id;

  UPDATE public.whatsapp_ai_suggestions m SET conversation_id = k.keeper_id
  FROM public.whatsapp_conversations c JOIN _dup_conv_keeper k ON k.order_id = c.order_id
  WHERE m.conversation_id = c.id AND c.id <> k.keeper_id;

  UPDATE public.whatsapp_automation_runs m SET conversation_id = k.keeper_id
  FROM public.whatsapp_conversations c JOIN _dup_conv_keeper k ON k.order_id = c.order_id
  WHERE m.conversation_id = c.id AND c.id <> k.keeper_id;

  UPDATE public.whatsapp_campaign_recipients m SET conversation_id = k.keeper_id
  FROM public.whatsapp_conversations c JOIN _dup_conv_keeper k ON k.order_id = c.order_id
  WHERE m.conversation_id = c.id AND c.id <> k.keeper_id;

  UPDATE public.whatsapp_ai_memory m SET conversation_id = k.keeper_id
  FROM public.whatsapp_conversations c JOIN _dup_conv_keeper k ON k.order_id = c.order_id
  WHERE m.conversation_id = c.id AND c.id <> k.keeper_id;

  DELETE FROM public.whatsapp_conversations c
  USING _dup_conv_keeper k
  WHERE c.order_id = k.order_id AND c.id <> k.keeper_id;

  DROP TABLE _dup_conv_keeper;
END $$;

-- Prevent this from ever happening again: at most one conversation per
-- linked order (unlinked conversations, order_id IS NULL, are unaffected
-- and still governed by the existing phone_unlinked_unique constraint).
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_conversations_order_unique
ON public.whatsapp_conversations (order_id) WHERE order_id IS NOT NULL;
