---
name: WhatsApp COD Parcel Inspection Policy
description: AI must tell customers they CAN open and inspect the parcel before paying, since orders are Cash on Delivery in Pakistan.
type: feature
---

For Pakistan COD: customers are allowed to OPEN and INSPECT the parcel BEFORE paying the courier. If not satisfied → they refuse the parcel and pay nothing.

`aiContinueReply` system prompt in `supabase/functions/whatsapp-webhook/index.ts` includes an `inspectionRule` block that:
- Detects open/inspect requests in EN / Urdu / Roman Urdu ("open parcel", "khol kr dekh", "check before pay", "kya main parcel khol sakta hun", etc.)
- Forces AI to reply YES, the customer can open & check before paying.
- Reassures: if not satisfied → refuse the parcel, no payment.
- Forbids the wrong "payment first then check" answer.

Triggered by AB-789 where AI wrongly told customer they couldn't open before paying.
