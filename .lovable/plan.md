

## Update Failed Attempt Mapping in ORIO Status Sync

Currently only the ORIO sub-status `"failed attempt"` maps to internal `failed_attempt`. You want 4 sub-statuses to map to `failed_attempt`, and existing orders already in those sub-statuses to be retroactively updated.

### Changes

**1. Update status mapping** in `supabase/functions/orio-status-sync/index.ts`

Re-map these ORIO sub-statuses from `"shipped"` → `"failed_attempt"`:
- `failed attempt` (already mapped — keep)
- `incomplete address`
- `refused to accept` (currently mapped to `rejected` — will change to `failed_attempt`)
- `customer not answering`

New mapping block:
```ts
"failed attempt": "failed_attempt",
"incomplete address": "failed_attempt",
"refused to accept": "failed_attempt",
"customer not answering": "failed_attempt",
```

All other sub-statuses keep their current mapping.

**2. Backfill existing orders** via a one-time SQL update

Update all orders where `orio_shipping_status` (case-insensitive) matches one of the 4 sub-statuses but `delivery_status` is not yet `failed_attempt`:
- Set `delivery_status = 'failed_attempt'`
- Insert a corresponding `order_history` row (`action_type = 'orio_sync_backfill'`) so billing/audit stays consistent
- Insert a synthetic `shipped` history row first if none exists (matching the existing sync logic for post-shipped jumps)

**3. Redeploy** the `orio-status-sync` edge function so the next 5-min cron picks up new mappings.

### Notes

- `refused to accept` previously mapped to `rejected` — confirming the change to `failed_attempt` per your spec.
- The fetch query filter `not.in.("delivered","returned","cancelled","return","rejected")` still allows these orders to be re-evaluated on next sync.
- No schema changes; only edge function code + data update.

