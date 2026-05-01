---
name: WhatsApp pending-intent auto-handoff
description: Conversations stuck on a pending_button_intent for >60 minutes are auto-routed to the agent queue so orders never sit in WhatsApp limbo.
type: feature
---

When a customer presses a CONFIRM button (e.g. "Yes, Confirm My Order") and the system gates through the AI to ask for a detailed address, the order may stall if the customer never replies. To prevent orders from being stuck in WhatsApp forever (AB-606), `tickPendingIntentHandoff` (in `whatsapp-automation-runner`) runs on every cron tick and:

1. Finds conversations where `pending_button_intent IS NOT NULL` AND both `last_message_at` and `pending_button_intent.created_at` are older than 60 minutes.
2. Resets the order: `confirmation_status="new"`, `confirmation_channel="agent"`, `agent_id=null`, `whatsapp_status="handed_to_agent"`, with note "Auto-routed to agent — customer never replied to AI address request".
3. Logs `whatsapp_auto_handoff` to `order_history`.
4. Clears `pending_button_intent`, sets `ai_enabled=false`, `status="manual_review_needed"` on the conversation.

## Skip-gate when stored address is deliverable
Independent fix in `whatsapp-automation-runner.applyButtonAction`: when the customer presses a CONFIRM button AND the stored address already passes `isAddressDeliverable`, we NEVER stash a `pending_button_intent` — even if the admin set `ai_gate="validate"`. We confirm the order directly, set `whatsapp_status="confirmed"`, and clear any stale `pending_button_intent` on the conversation. This mirrors `applyOutcome` in `whatsapp-webhook` and prevents the AI from asking for an address that's already on file (root cause of AB-606 customer confusion).

## Files
- `supabase/functions/whatsapp-automation-runner/index.ts` — `applyButtonAction` (skipGateForConfirmedAddress) + `tickPendingIntentHandoff` cron sweep.
