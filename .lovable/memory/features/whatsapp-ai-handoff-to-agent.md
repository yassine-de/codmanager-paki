---
name: WhatsApp AI handoff_to_agent tool
description: AI must call handoff_to_agent (never stall) when it can't answer; the order is released to the agent queue and AI is disabled on the conversation.
type: feature
---

The WhatsApp AI in `whatsapp-webhook` exposes a `handoff_to_agent(reason)` tool. The system prompt FORBIDS stalling phrases ("let me check", "please hold on", "I'll get back to you", "khol kr dekh ke batata hoon", "ek minute", etc.) in any language. Instead, the AI MUST:

1. Call `handoff_to_agent` with a short English reason.
2. In its text reply, tell the customer (in their own language) it's transferring them to a human agent who will contact them shortly.

When the tool fires, the webhook handler:
- Sets `whatsapp_conversations.ai_enabled = false`, `status = 'needs_human'` (AI stops auto-replying; the per-conversation AI On/Off toggle reflects this).
- If the order is NOT yet finalized (`confirmed/booked/shipped/delivered/canceled`), updates `orders` to: `confirmation_status='new'`, `confirmation_channel='agent'`, `agent_id=null`, `whatsapp_status='handoff_to_agent'`, `whatsapp_note='AI handoff to human agent. Reason: ...'`. This puts it back in the agent queue (NEW priority) so any agent can claim it.
- If the order is already finalized, only the note + AI-off are applied (no status mutation).
- Logs an `order_history` row with `action_type='whatsapp_handoff'`, role `ai`, tracking `confirmation_status` and `agent_id` deltas.

Triggered by AB-791 where AI sent "Please hold on for a moment, I'll get back to you shortly" and never followed up, leaving the customer stuck.
