-- One-time data correction (referenced from the review_note left on the
-- affected rows). tickPendingIntentHandoff() in whatsapp-automation-runner
-- used to unconditionally set whatsapp_conversations.status =
-- 'manual_review_needed' whenever a "confirm order" button sat unanswered
-- 60+ minutes, even when the order had already been resolved by someone
-- (postponed/confirmed/cancelled/etc) and there was nothing to review. The
-- function itself is already fixed (see the code change alongside this
-- migration); this clears the stale false flags that fix left behind.
--
-- Scope is deliberately narrow: only conversations where the flag could
-- ONLY have come from that sweeper bug — zero inbound free-text messages
-- ever (rules out the legitimate "customer sent free text" trigger) and no
-- "force_to_agent" history (rules out a deliberate staff action). Verified
-- against live data before applying: 13 postponed orders had the flag, 4
-- were genuine (real customer replies or a manual Force to Agent) and were
-- confirmed to be excluded by this WHERE clause; only the remaining 9 were
-- touched.

UPDATE public.whatsapp_conversations c
SET status = 'handled',
    resolved_at = now(),
    review_note = 'Auto-corrected: flagged needs-review by a sweeper bug (stale confirm button on an already-postponed order), not a real issue. See migration 20260818210000.'
FROM public.orders o
WHERE o.order_id = c.order_id
  AND c.status = 'manual_review_needed'
  AND c.pending_button_intent IS NULL
  AND o.confirmation_status = 'postponed'
  AND NOT EXISTS (SELECT 1 FROM public.whatsapp_messages m WHERE m.conversation_id = c.id AND m.direction = 'in' AND m.message_type = 'text')
  AND NOT EXISTS (SELECT 1 FROM public.order_history h WHERE h.order_id = c.order_id AND h.action_type = 'force_to_agent');
