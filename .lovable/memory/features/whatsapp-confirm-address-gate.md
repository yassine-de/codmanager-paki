---
name: WhatsApp Confirm Address Gate
description: Customer YES button or text reply never finalizes order until both deliverable address AND positive intent are present
type: feature
---

The WhatsApp confirmation flow gates auto-confirmation behind TWO requirements to avoid wrongful confirmations:

## Stored-address shortcut (in `tryExtractAndConfirmAddress`, `whatsapp-webhook`)

The shortcut auto-confirms an order using the address already on file (from sheet import) — but ONLY when:

1. **Address is deliverable** per `isAddressDeliverable()` (see `whatsapp-ai-auto-confirm`).
2. **Customer expressed clear intent** — one of:
   - `pending_button_intent` is set on the conversation (customer clicked the YES button), OR
   - Customer's latest text matches `positiveIntentRe` (yes/ok/haan/ji/confirm/sahi/theek/correct/order kar do/bhej do/chahiye/book/accept/agree, plus Urdu/Arabic equivalents).
3. **Customer's text does NOT match `negativeIntentRe`** (cancel/don't know/wrong order/nahi chahiye/الغاء/etc.) — AB-790 fix.

If text is neutral (greeting, auto-reply, "thanks", off-topic chitchat) → shortcut is SKIPPED, AI continues conversation, no confirmation happens.

### Incidents fixed
- **AB-790**: customer wrote "I don't know about that order" → AI shortcut auto-confirmed because address was on file. Fixed by `negativeIntentRe` guard.
- **AB-862**: customer's WhatsApp business sent an auto-reply "Hello & Welcome to Land Advisor 😊 Smart moves start here." → AI shortcut auto-confirmed because address was on file and text wasn't negative. Fixed by requiring `positiveIntentRe` (or pending button intent).

## Code location
`supabase/functions/whatsapp-webhook/index.ts` → `tryExtractAndConfirmAddress()`, near line ~1685.
