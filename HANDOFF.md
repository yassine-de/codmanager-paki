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

PostEx create-order now reaches the API, but returns:

```text
BOTH PICKUP ADDRESS CODE AND STORE ADDRESS CODE MUST NOT BE NULL AT THE SAME TIME
```

This means the next required value is one of:

- PostEx Pickup Address Code, or
- PostEx Store Address Code

Once the user provides the code, set it in the new Supabase project, preferably:

```text
postex_pickup_address_code
```

or if PostEx specifically requires store address code, add/update the function payload accordingly.

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

1. Get the PostEx pickup/store address code from the user.
2. Store it in the new Supabase project.
3. Retry `shipping-sync-retry`.
4. Verify shipments for `OR-1` through `OR-10` have tracking numbers.
5. Check that fulfillment queue receives those shipments.
6. Test outbound scan with one tracking number.
7. Verify stock decreases by the order item quantity.
8. Test return scan.
9. Verify stock is added back to MAIN/RETURNS/DAMAGED depending on return condition.

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
