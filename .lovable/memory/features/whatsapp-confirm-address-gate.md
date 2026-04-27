---
name: WhatsApp confirm-button address gate
description: Customer YES button auto-confirms when stored address is deliverable; otherwise AI takes over to validate the delivery address with the customer, then auto-confirms.
type: feature
---

When a customer clicks a confirm button (YES / Confirmer / "Confirm my order") on any WhatsApp template — whether it goes through `whatsapp-webhook.applyOutcome` or the automation-runner `applyButtonAction` — we evaluate the **stored** address:

- **Stored address is ALREADY deliverable** → confirm immediately. We set `confirmation_status="confirmed"`, `confirmation_channel="whatsapp"`, `whatsapp_status="confirmed"`, `confirmed_at=now()`, optionally book shipping. We do NOT wait for a follow-up text from the customer.
- **Stored address is missing/weak** → gate through the AI: stash `pending_button_intent`, set `whatsapp_status="pending_address"`, force AI takeover, ask the customer for their full address, finalize via `tryExtractAndConfirmAddress` once they reply.

## Why this two-path logic
Original "always-gate" version (post AB-348) caused AB-369 to be stuck forever in `pending_address`: the customer's stored sheet-import address was already valid, the AI asked for the address again, but the customer never replied (button click contained no text and they had nothing more to add). Without a follow-up text, `tryExtractAndConfirmAddress` never ran, so the order stayed `confirmation_status="new"` indefinitely.

Now: deliverable address → confirm now (no AI ping). Weak address → gate through AI as before.

## isAddressDeliverable heuristic (shared)
Rejects: too short (<10 chars), <2 tokens, fake/test/placeholder words, addresses with no number AND no street keyword. Accepts addresses with a number OR a street keyword (house, street, road, lane, block, sector, mohalla, near, chowk, etc., including Urdu equivalents) AND a non-empty city.

## tryExtractAndConfirmAddress skip-rule
Extraction (called inside `aiContinueReply` on inbound text) skips ONLY when ALL three are true:
1. `confirmation_status === "confirmed"`
2. The stored address `isDeliverable`
3. There is NO `pending_button_intent` on the conversation

If any pending_button_intent exists, extraction always runs (so the badge gets cleared and history gets logged) even on already-confirmed orders.

## Stored-address short-circuit inside extraction (legacy, still used)
If the customer DID reply with text after the button click but the stored address was already deliverable, `tryExtractAndConfirmAddress` short-circuits and finalizes the existing address without calling OpenAI.

## Inbox UI
The conversation list in `WhatsappInbox.tsx` shows a yellow "⏳ Awaiting address" badge next to any conversation whose `pending_button_intent.intent === "confirm"`.

## Files
- `supabase/functions/whatsapp-webhook/index.ts` — `applyOutcome` confirms immediately when stored address is deliverable, else gates; `tryExtractAndConfirmAddress` runs whenever a `pending_button_intent` exists.
- `supabase/functions/whatsapp-automation-runner/index.ts` — `applyButtonAction` sets `forceAddressGate = wantsConfirm && !!order && !storedAddrDeliverable` (gate skipped when address is good).
- `src/pages/whatsapp/WhatsappInbox.tsx` — "⏳ Awaiting address" pill in conversation list.
