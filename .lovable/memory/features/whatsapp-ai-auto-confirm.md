---
name: WhatsApp AI Auto-Confirm on Complete Address
description: When AI collects a complete delivery address, the order is auto-confirmed and city is mapped to the ORIO cities dropdown
type: feature
---

The WhatsApp AI continuation flow (`whatsapp-webhook` edge function) automatically confirms an order once the customer provides a complete, deliverable address.

## Trigger
After every AI-generated reply to a customer text message (in `aiContinueReply`), the system runs `tryExtractAndConfirmAddress`.

## Extraction logic
- Uses OpenAI JSON mode (response_format: json_object) with the same model as the AI assistant.
- Sends last 10 conversation messages + latest customer text (batched).
- Strict schema: `{ complete: boolean, full_address: string, city: string }`.

## Deliverability rule (extractor + AI prompt) — RURAL-FRIENDLY
Pakistan has BIG cities AND many small towns / villages / tehsils. The rule adapts:

`complete=true` requires:
1. A city OR town OR tehsil OR village name (anywhere in PK), AND
2. AT LEAST ONE locator (any ONE is enough):
   - house/flat/plot/shop number, OR
   - specific street/lane/road/gali name, OR
   - neighborhood/area/colony/block/sector/phase/mohalla/town name, OR
   - recognizable named landmark with proximity wording (e.g. "near Allahdin Hotel", "Fuara Chowk", "near Adalat Stop").

In small towns / villages / tehsils a road / chowk / named landmark + town IS enough — the rider knows the town and asks locally. We do NOT demand a formal block/sector/phase that does not exist there. In big metros (Karachi, Lahore, Islamabad, Rawalpindi, Faisalabad, Multan, Peshawar, …) we prefer area + locator when possible.

REJECT: just a city name, single vague words ("home", "here", "same", "send it"), fake/test/placeholder values, or a giant institution with no street/area context.

`full_address` excludes the city (city is stored separately).

## City matching
- City must match `orio_cities_cache` (case-insensitive exact, then partial fallback). Note ORIO sometimes uses non-standard spellings (e.g. "Batgram" for Batagram).
- Non-blocking: if no match, the order is still confirmed using the raw city text.

## Auto-confirm side effects
On a valid extraction the order is updated:
- `customer_address` ← extracted full address
- `customer_city` ← matched ORIO city (canonical name)
- `confirmation_status` = "confirmed", `confirmation_channel` = "whatsapp", `confirmed_at` = now (only if not already confirmed)
- `whatsapp_status` = "confirmed"
- If `whatsapp_settings.auto_book_shipping` is true → `delivery_status="booked"`, `shipping_status="Booked"` (triggers ORIO sync)

Conversation status → "confirmed", outcome → "confirmed".

## Skip conditions
- Order already `confirmation_status = "confirmed"` AND already has a deliverable address on file → no-op.
- ORIO cities cache empty → skip.
- AI returns `complete=false` → skip (AI prompt instructs it to keep asking).

## Known historical bug (fixed)
Original prompt required city + formal area + precise locator (3 mandatory criteria). This silently rejected nearly all rural Pakistan addresses (Batagram, Layyah, Tank, Wari, DIK, etc.) because they don't have formal blocks/sectors. AI would reply with confirmation in chat but the DB never got updated. Prompt was rewritten to accept rural addresses while still rejecting junk.
