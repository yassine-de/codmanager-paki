# COD Manager Pakistan PostEx Migration - Handoff

## Current Repo

- GitHub: https://github.com/yassine-de/codmanager-paki
- Local laptop path used so far: `C:\Users\adilh\Documents\CODMANAGER PAKISTAN POSTEX\codpakistani`
- Main branch: `main`
- Old repo is read-only reference only: `https://github.com/voldoo/codpakistani.git`

Do not modify the old GitHub repo or old Supabase project.

## Supabase

- New project ref: `miyzjhjcyowkttdszxit`
- New project URL: `https://miyzjhjcyowkttdszxit.supabase.co`
- Old project ref, read-only reference only: `gxyxmxzphyepsmecwbfi`

Sensitive values are intentionally not written in this file. They are in Supabase/app settings/secrets where needed.

## What Has Been Implemented

- New database schema for multi-carrier shipping, fulfillment and inventory.
- ORIO is disabled as a carrier row, not used as the default carrier.
- PostEx is active as carrier `postex`.
- Shipping functions were made generic:
  - `shipping-sync`
  - `shipping-sync-retry`
  - `carrier-status-sync`
- Warehouse/Fulfillment tables and UI exist.
- Scan RPCs exist:
  - `scan_outbound_shipment`
  - `scan_return_shipment`
- Cronjobs are scheduled in the new Supabase DB:
  - `carrier-shipping-retry` every 5 minutes
  - `carrier-status-sync` every 5 minutes
  - `whatsapp-automation-runner-tick` every minute
  - `whatsapp-campaign-scheduler` every minute
  - `whatsapp-ai-sweeper` every minute
- PostEx API token has been set in the new DB app settings.
- PostEx pickup address code has been set in the new DB app settings:
  - `postex_pickup_address_code = 001`
- WhatsApp settings were copied from the old DB where available.
- Admin users exist:
  - `adil@codmanager.com`
  - `bader@codmanager.com`
  - `anwar@codmanager.com`
- Agent user exists:
  - `agent1@codmanager.com`
  - password: ask the user or use the value provided in the thread, do not store it here.

## Important Recent Commits

- `16aea03` - Schedule background sync jobs
- `54b37f2` - Fix PostEx city lookup parameter

## Test Data Created

Batch id:

```text
TEST-20260705080416
```

Product:

```text
Name: Test Product TEST-20260705080416
SKU: TEST-20260705080416-SKU
Initial MAIN stock: 100
```

Orders:

```text
OR-1 through OR-10
```

All 10 orders:

- are `confirmed`
- have `source_ref = TEST-20260705080416`
- have address containing `TEST ADDRESS TEST-20260705080416`
- have `order_items` linked to the test product variant
- are ready for PostEx sync once the pickup/store address code is configured

## Current Blocking Issue

Resolved on 2026-07-05:

- PostEx merchant address lookup returned `addressCode = 001`.
- `postex_pickup_address_code` was stored in the new Supabase project.
- `shipping-sync` was deployed with optional `storeAddressCode` support as a fallback.
- Test orders `OR-1` through `OR-10` were retried successfully and now have PostEx tracking numbers.
- Warehouse outbound flow was simplified:
  - The employee scans the PostEx tracking number once in `Ship Package`.
  - The scan completes fulfillment, sets picked/packed/label timestamps, records the outbound scan and deducts MAIN stock.
  - Manual Picked/Packed/Label buttons were removed from the main queue UI.
- Warehouse label printing was added:
  - `shipping-sync` action `generate-labels` calls PostEx `v1/get-invoice?trackingNumbers=...`.
  - Warehouse `Print Labels` opens PostEx Airway Bill PDFs for pending tracking numbers.
  - PostEx supports a maximum of 10 tracking numbers per PDF, so the UI splits labels into batches of 10.

No current PostEx create-order blocker is known.

## How To Continue On Another PC

Clone or update the repo:

```bash
git clone https://github.com/yassine-de/codmanager-paki.git
cd codmanager-paki
```

or:

```bash
git pull origin main
```

In Codex on the PC, start with:

```text
Read HANDOFF.md and continue the PostEx migration. We need to set the PostEx pickup/store address code and retry syncing test orders OR-1 to OR-10.
```

## Next Steps

1. In Warehouse, click `Print Labels` and verify the PostEx PDF opens/prints.
2. Test outbound scan with one tracking number.
3. Verify stock decreases by the order item quantity.
4. Verify fulfillment item has picked/packed/label/scanned timestamps.
5. Test return scan.
6. Verify stock is added back to MAIN/RETURNS/DAMAGED depending on return condition.

## Latest Verification - 2026-07-05

PostEx pickup address:

```text
Address code: 001
City: Lahore
Address type: Default Address
```

Synced test orders:

```text
OR-1  -> 24632910000001
OR-2  -> 25632910000002
OR-3  -> 28632910000003
OR-4  -> 29632910000004
OR-5  -> 24632910000005
OR-6  -> 28632910000006
OR-7  -> 27632910000007
OR-8  -> 22632910000008
OR-9  -> 29632910000009
OR-10 -> 22632910000010
```

All 10 shipments:

- have `sync_status = synced`
- have `sync_error = null`
- have `normalized_status = booked`
- have matching `fulfillment_items` rows with `status = pending`

Current test SKU stock:

```text
SKU: TEST-20260705080416-SKU
MAIN quantity_on_hand: 100
```

## Useful Checks

Check test orders:

```sql
select order_id, customer_address, confirmation_status, fulfillment_status
from public.orders
where source_ref = 'TEST-20260705080416'
order by order_id;
```

Check shipments:

```sql
select order_id, tracking_number, sync_status, sync_error, normalized_status
from public.shipments
where order_id in ('OR-1','OR-2','OR-3','OR-4','OR-5','OR-6','OR-7','OR-8','OR-9','OR-10')
order by order_id;
```

Check stock:

```sql
select *
from public.inventory_balance_view
where sku = 'TEST-20260705080416-SKU';
```

## Notes

- Do not create new tables or functions with `orio_` names.
- Keep old app functionality unchanged except for shipping carrier abstraction and fulfillment/inventory additions.
- Do not hard-code secrets in Git.
- The PostEx city lookup was fixed to use `operationalCityType=delivery`.
