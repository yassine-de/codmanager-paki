---
name: WhatsApp confirm-button address gate
description: Customer YES/Confirm button NEVER finalizes the order until a deliverable address is on file. AI takes over to ask for the full address, then auto-confirms.
type: feature
---

When a customer clicks a confirm button (YES / Confirmer / "Confirm my order") on any WhatsApp template — whether it goes through the legacy `whatsapp-webhook.applyOutcome` path or the new automation-runner `applyButtonAction` path — we **force** address validation BEFORE flipping `confirmation_status` to `confirmed`.

## Logic
Both paths run the same `isAddressDeliverable(addr, city)` check (length ≥ 10, ≥ 2 word tokens, must contain a digit OR a street/area keyword like house/flat/street/road/block/sector/town/colony/near/chowk/etc., must NOT match fake/test/placeholder words).

If `isAddressDeliverable === false`:
- `confirmation_status` is **NOT** changed.
- `whatsapp_status = "pending_address"` and a `whatsapp_note` flag is written ("Customer confirmed via WhatsApp — awaiting full delivery address").
- `whatsapp_conversations.pending_button_intent = { intent: "confirm", button_text, mapped_status: "confirmed", created_at }` is stashed.
- `whatsapp_conversations.ai_enabled = true` (AI takeover forced).
- The AI continuation runs and reads `pending_button_intent` from a fresh refetch of `conv` (NOT the stale snapshot from before applyOutcome). Its system prompt instructs it to:
  - Thank the customer for confirming.
  - In the SAME short message ask politely (in customer language) for the FULL address: house/flat #, street, area/block, landmark + city.
  - NEVER say "your order is being processed", "your order is confirmed", "we will ship now" until the address is real.
- When the customer replies with a real address, the existing `tryExtractAndConfirmAddress` flow extracts city + full_address, updates the order, sets `confirmation_status = "confirmed"`, clears `pending_button_intent`, and (if `auto_book_shipping`) marks `delivery_status = "booked"`.

If the address IS deliverable when the button is clicked → confirm immediately like before (no extra round-trip).

## Why
"Karachi center", "Lahore home", a single landmark with no street/area, single-word vague replies ("home", "here", "same"), or fake/test text would otherwise sail through to ORIO and the rider has nowhere to go. The gate guarantees every confirmed order has at least city + one usable locator.

## Inbox UI
The conversation list in `WhatsappInbox.tsx` shows a yellow "⏳ Awaiting address" badge next to any conversation whose `pending_button_intent.intent === "confirm"` so admins can spot pending-address customers at a glance.

## Files
- `supabase/functions/whatsapp-webhook/index.ts` — module-level `isAddressDeliverable`; `applyOutcome` gates confirm; AI prompt (`pendingIntentRule`) tells the AI not to say "processing"; `aiContinueReply` re-fetches `conv` after the batch wait.
- `supabase/functions/whatsapp-automation-runner/index.ts` — `applyButtonAction` force-enables `aiGated` whenever `wantsConfirm && !addressOk`, regardless of admin's `ai_gate` setting.
- `src/pages/whatsapp/WhatsappInbox.tsx` — "⏳ Awaiting address" pill in conversation list.
