---
name: WhatsApp AI Auto-Confirm on Complete Address
description: When AI collects a complete delivery address, the order is auto-confirmed and city is mapped to the ORIO cities dropdown
type: feature
---

The WhatsApp AI continuation flow (`whatsapp-webhook` edge function) automatically confirms an order once the customer provides a complete, deliverable address.

## Trigger
After every AI-generated reply to a customer text message (in `aiContinueReply`), the system runs `tryExtractAndConfirmAddress`.

## Deliverability rule — TIGHTENED (AB-861 fix)

`isAddressDeliverable(addr, city)` requires city present, address ≥ 12 chars + ≥ 3 tokens, NOT a fake placeholder, AND any of:
- **digit + (strong/weak/landmark keyword)** — e.g. "House 12 Gulshan", OR
- **digit + ≥ 4 tokens** — e.g. "12 4 DHA Lahore", OR
- **strong keyword** alone (house/flat/plot/block/sector/phase/apartment/building/floor/villa/tower/plaza, or "shop/office/street/gali no <digit>"), OR
- **≥ 2 distinct weak keywords** (street/road/lane/town/village/colony/mohalla/gali/bazaar/market/society/park/stop/gate/center/care/hotel/masjid/school/hospital/bank/station/chowk/tehsil/abad/pura/nagar/kot/garh/wala + Urdu).

Landmark-only loophole removed (AB-861): "1 weak + landmark + 5 tokens" no longer passes.

### What gets ACCEPTED:
- "House 12 Street 4 Gulshan-e-Iqbal" ✅ (digit + street)
- "Tehsil Dipalpur Madina Chowk Mobile Care Shop" ✅ (multiple weak hits)
- "Phase 2 DHA Lahore" ✅ (strong: phase)
- "Mohalla Islamia Gali 2 Layyah" ✅ (digit + gali)

### What gets REJECTED (tightened):
- "Emaar builders and construction company near sarena hotel" ❌ — only 1 weak (hotel) + landmark (AB-861)
- "National bank ghalegay" ❌ — only 1 weak (AB-803)
- "Near UBL Bank" ❌
- "Lahore" alone ❌
- "test" / "same" / "asdf" / "n/a" ❌


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
