---
name: WhatsApp AI Auto-Confirm on Complete Address
description: When AI collects a complete delivery address, the order is auto-confirmed and city is mapped to the ORIO cities dropdown
type: feature
---

The WhatsApp AI continuation flow (`whatsapp-webhook` edge function) automatically confirms an order once the customer provides a complete, deliverable address.

## Trigger
After every AI-generated reply to a customer text message (in `aiContinueReply`), the system runs `tryExtractAndConfirmAddress`.

## Deliverability rule — RELAXED VALIDATION (AB-614 fix)

`isAddressDeliverable(addr, city)` requires:
1. City present, AND
2. Address ≥ 12 chars + ≥ 3 meaningful tokens, AND
3. ANY ONE of:
   - has a digit (house/plot number), OR
   - matches `preciseKeyword` regex (street, road, lane, block, sector, phase, mohalla, gali, bazaar, market, society, colony, **shop, office, store, center, care, hotel, masjid, mosque, school, college, hospital, bank, station, chowk, square, tehsil, ward, town, village, abad, pura, nagar, kot, gunj, garh, wala**, Urdu equivalents پور آباد گھر مکان گلی سڑک محلہ فلیٹ بلاک سیکٹر چوک تحصیل دکان), OR
   - has a `landmarkIndicator` (near/opposite/behind/front/main/stop/adjacent/side) + ≥ 4 tokens

### What gets ACCEPTED now (AB-614 fix):
- "Tehsil Dipalpur Madina Chowk Mobile Care Shop" ✅ (shop + chowk + tehsil)
- "Near UBL Bank Main Bazaar Road Batagram" ✅ (bank + bazaar + road)
- "House 12 Street 4 Gulshan-e-Iqbal" ✅ (number + street)
- "Mohalla Islamia Gali 2 Layyah" ✅ (mohalla + gali)

### What still gets REJECTED:
- "Lahore" alone (just city, no other detail)
- "test" / "same" / "asdf" / "n/a" (fake/placeholder)
- Single word with no context

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

## Code location
`isAddressDeliverable` is a single module-level export in `supabase/functions/whatsapp-webhook/index.ts` (line ~374). All call-sites (`applyOutcome`, AI prompt builder, `tryExtractAndConfirmAddress`) reuse this same helper. The automation-runner has a synchronized inline copy with identical regex.
