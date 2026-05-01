---
name: WhatsApp Confirm Address Gate
description: Customer YES button never finalizes order until AI validates a deliverable address; auto-confirm shortcut is blocked on negative intent (denial/cancel).
type: feature
---

In `whatsapp-webhook` → `tryExtractAndConfirmAddress`:

1. If the order already has a deliverable stored address (`isAddressDeliverable`) AND `confirmation_status !== 'confirmed'` AND there is no negative intent → finalize immediately (`confirmation_status='confirmed'`, `confirmation_channel='whatsapp'`, optional auto-book).
2. Otherwise, run the AI address extractor against the latest customer text to detect a fresh address.

## Negative-intent guard (AB-790 fix)

Before the stored-address shortcut runs, the customer's latest text is matched against a multilingual negative-intent regex covering:
- denial: "I don't know about that order", "didn't order", "not mine", "wrong order", "nahi pata", "maine order nahi kiya", "غلط", "پتہ نہیں"
- cancellation: "cancel", "annul", "annuler", "الغاء", "إلغاء", "rahne do", "mat bhejo", "stop", "refuse", "return", "refund", "mistake", "by mistake"
- refusal: "I don't want", "nahi chahiye", "نہیں چاہیے", "ما بغيتش", "free", "muft" (asking for free product)

If any term matches → the shortcut is SKIPPED and the function returns. The order stays in its current status so a human agent (or the AI's cancellation flow / discount flag / handoff_to_agent tool) can take over. Without this guard, AB-790 was auto-confirmed the moment the customer first replied — even though they said they didn't recognize the order and then asked to cancel.

## Pending-button-intent path
If `pending_button_intent` is set on the conversation (customer clicked "Confirm" earlier), the gate still runs the address validator, but the negative-intent guard does NOT apply (button click is the explicit positive intent).
