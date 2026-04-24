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
- `complete=true` requires: house/flat + street + area + city all present.
- `full_address` excludes the city (city is stored separately).

## City matching
- City must match `orio_cities_cache` (case-insensitive exact, then partial fallback).
- If no match → no confirmation, AI keeps asking.

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
