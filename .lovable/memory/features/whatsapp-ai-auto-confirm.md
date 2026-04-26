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
- Sends last 10 conversation messages + latest customer text.
- Strict schema: `{ complete: boolean, full_address: string, city: string }`.

## Strict deliverability rule (both extractor + AI prompt)
`complete=true` requires ALL three:
1. A real Pakistan city, AND
2. A specific area / neighborhood / colony / block / sector / phase (e.g. "Gulshan-e-Iqbal Block 7", "DHA Phase 5", "G-9/4", "Saddar"), AND
3. A precise locator INSIDE that area: house/flat/plot/shop number OR specific street/lane/road/gali name OR a small named landmark tied to a specific street.

A single big landmark (government building, big institution, big plaza, university, "near main bazaar") with NO street/house/block is REJECTED — courier rider would still get lost. AI must keep asking for the missing piece.

`full_address` excludes the city (city is stored separately).

## City matching
- City must match `orio_cities_cache` (case-insensitive exact, then partial fallback).
- Non-blocking: if no match, the order is still confirmed using the raw city text.

## Auto-confirm side effects
On a valid extraction the order is updated:
- `customer_address` ← extracted full address
- `customer_city` ← matched ORIO city (canonical name)
- `confirmation_status` = "confirmed", `confirmation_channel` = "whatsapp", `confirmed_at` = now
- `whatsapp_status` = "confirmed"
- If `whatsapp_settings.auto_book_shipping` is true → `delivery_status="booked"`, `shipping_status="Booked"` (triggers ORIO sync)

Conversation status → "confirmed", outcome → "confirmed".

## Skip conditions
- Order already `confirmation_status = "confirmed"` → no-op.
- ORIO cities cache empty → skip.
- AI returns `complete=false` → skip (AI prompt instructs it to keep asking).
