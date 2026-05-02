---
name: WhatsApp Confirm Address Gate
description: Customer YES button never finalizes order without deliverable address; AI never re-asks for an address when one is already on file
type: feature
---

The WhatsApp confirmation flow gates auto-confirmation behind two requirements and uses one consistent address-deliverability check across every code path.

## 1. Stored-address shortcut (`tryExtractAndConfirmAddress`, `whatsapp-webhook`)

Auto-confirms an order using the stored address ONLY when:

1. `isAddressDeliverable()` returns true (see `whatsapp-ai-auto-confirm`).
2. Customer expressed clear intent — either:
   - `pending_button_intent` set on the conversation (clicked YES button), OR
   - Customer text matches `positiveIntentRe` (yes/ok/haan/ji/confirm/sahi/theek/correct/order kar do/bhej do/chahiye/book/accept/agree, plus Urdu/Arabic equivalents).
3. Customer text does NOT match `negativeIntentRe` (cancel/don't know/wrong order/nahi chahiye/الغاء/etc.).

If neutral text (greeting, auto-reply, "thanks", off-topic) → shortcut SKIPPED, AI continues.

## 2. Button-click direct path (`applyOutcome`, `whatsapp-webhook`)

When customer clicks YES button:
- Stored address deliverable → confirm immediately, log `ai_confirm`, mark conversation status `confirmed`.
- Stored address weak → set `pending_button_intent`, set `whatsapp_status=pending_address`, AI asks for full address, `tryExtractAndConfirmAddress` finalizes when received.

## 3. Automation `ai_step` short-circuit (AB-861 fix)

The "New order confirmation" automation runs an `ai_step` after the YES button. Without a guard, the AI would always send "please send your full detailed address" — even when `applyOutcome` had ALREADY confirmed the order using the stored address. This contradicted the customer experience.

In `whatsapp-automation-runner` the `ai_step` now:
- **SKIPS execution entirely** when `order.confirmation_status === "confirmed"` AND `isAddressDeliverable(addr, city)` is true.
- Otherwise injects an explicit `ADDRESS STATUS` line into the system prompt:
  - deliverable → "DO NOT ask for address again. Send a short warm confirmation."
  - vague/missing → "Politely ask for full address. Do NOT confirm yourself."

This eliminates the race where webhook auto-confirms but the parallel `ai_step` re-asks for the address.

### Incidents fixed
- **AB-790**: customer wrote "I don't know" → AI shortcut auto-confirmed because address on file. Fixed by `negativeIntentRe`.
- **AB-862**: business auto-reply "Hello & Welcome..." → shortcut auto-confirmed. Fixed by requiring `positiveIntentRe`.
- **AB-861**: address `"company near sarena hotel"` passed deliverability + the AI redundantly asked for full address right after `applyOutcome` confirmed. Fixed by tightening `isAddressDeliverable` (no landmark-only loophole) AND short-circuiting the `ai_step` when already confirmed.

## Code locations
- `supabase/functions/whatsapp-webhook/index.ts` → `isAddressDeliverable`, `applyOutcome`, `tryExtractAndConfirmAddress`
- `supabase/functions/whatsapp-automation-runner/index.ts` → `ai_step` branch (~line 486) and `isAddressDeliverable` mirror (~line 778)
