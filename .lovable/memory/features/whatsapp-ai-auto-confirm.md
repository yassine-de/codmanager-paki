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

## Deliverability rule — STRICT ADDRESS VALIDATION (AB-610 fix)

`complete=true` requires:
1. A city OR town OR tehsil OR village name (anywhere in PK), AND
2. AT LEAST ONE **precise** locator — "near [landmark]" ALONE is **NOT** enough:
   - house/flat/plot/shop number, OR
   - specific street/lane/road/gali name or number, OR
   - neighborhood/area/colony/block/sector/phase/mohalla name, OR
   - landmark + street/area combination (e.g. "near Allahdin Hotel, Main Bazaar Road")

### What gets REJECTED now (was previously accepted):
- "Near Allahdin Hotel" alone → NO (no street/area/number)
- "Chowk Fawara" alone → NO
- "opposite XYZ Masjid" alone → NO

### What gets ACCEPTED:
- "House 12 Street 4 Gulshan-e-Iqbal" → YES
- "Near Allahdin Hotel Main Bazaar Road" → YES (landmark + street)
- "Mohalla Islamia Gali 2" → YES (area + street)

### isAddressDeliverable heuristic (all 4 copies synchronized):
- Min length: 15 chars (was 10)
- Min tokens: 3 meaningful words (was 2)
- Has a digit → deliverable (house/plot number)
- Has a preciseKeyword (house/flat/plot/street/road/lane/block/sector/phase/colony/mohalla/gali/bazar/market/society etc.) → deliverable
- "near/opposite/chowk/main" alone without preciseKeyword → NOT deliverable

## City matching
- City must match `orio_cities_cache` (case-insensitive exact, then partial fallback).
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
