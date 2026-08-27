# Development Changelog

This document is for the development team. It records which changes were added to the project, when they were added, and who made them.

Source for existing entries: Git history (`git log`). Times are local times from the developer environment.

Last manual update: 2026-08-27 11:38 - Anwar Bounasser

## Working Rule

For every relevant change, add an entry before pushing:

```md
### YYYY-MM-DD HH:mm - Author
- Commit: `abc1234`
- Area: Orders / Warehouse / WhatsApp / Shipping / Finance / Database / UI
- Change: Briefly describe what changed.
- Reason: Explain why the change was made.
- Notes: Risks, deployment details, migrations, or tests.
```

## Changes

### 2026-08-27 11:38 - Anwar Bounasser
- Commit: `694c47a`
- Area: Delivery Analytics
- Change: Added a Delivery Sub-Status Breakdown section, a clickable Failed Attempt KPI card with a drill-down popup (by reason/courier/city), a Follow-Up Effectiveness section (coverage, rescue rate, stale re-attempts, per-agent table, outcome-by-status breakdown), a new Courier filter applied page-wide, and a premium visual redesign (KPI cards, section headers/cards, page header, filter bar, trend chart).
- Reason: Admin needed a way to see where delivery problems are concentrated and whether the Follow Up team is actually working/rescuing failed deliveries, plus a courier-level filter and a more polished look for the page.
- Notes: No migration or deploy needed — frontend-only change. All new KPIs/tables were verified against live data via direct SQL replication of their exact logic before shipping (Failed Attempt breakdown sums to the KPI total, Follow-Up rescue rate correctly excludes refused/area_restricted triage outcomes from the denominator, courier options match real carrier data). The visual redesign is styling-only — no data/logic changes.

### 2026-08-27 09:03 - Anwar Bounasser
- Commit: `d8c8535`
- Area: WhatsApp Inbox
- Change: Added "Delivery Company" as its own labeled field on the order card (next to City/Created), instead of only showing the courier name as a small suffix on the Tracking Number label.
- Reason: The follow-up/confirmation team needs to see which courier an order is with at a glance, not just as secondary text buried in the tracking field.
- Notes: No migration or deploy needed — frontend-only change.

### 2026-08-26 21:35 - Adil
- Commit: `3a9852b`
- Area: Shipping / M&P Status Synchronization
- Change: Mapped M&P statuses `Failed Delivered`, `Failed Delivery`, `Failed to Deliver`, and `Delivery Failed` to `failed_attempt` before applying the generic delivered-status rule.
- Reason: M&P uses `Failed Delivered` (tracking tag 16) for an unsuccessful delivery, but the previous text matcher saw the word `deliver` and incorrectly marked these shipments as delivered.
- Notes: Deployed `mnp-carrier-status-sync` and `mnp-shipping-sync`. Re-synchronized AB-2085, AB-2088, HG-40, AB-2121, and AB-2188; all five now have `delivery_status = failed_attempt`, `normalized_status = failed_attempt`, and no `delivered_at` value. PostEx behavior was not changed.

### 2026-08-26 08:28 - Anwar Bounasser
- Commit: `bbffdd6`
- Area: Orders
- Change: Fixed the Delivery=Pending filter on the Orders page, which always returned zero results.
- Reason: Orders that haven't shipped yet store `delivery_status` as NULL, not the literal string `"pending"` (the UI only displays NULL as "Pending" for readability), so `eq('delivery_status','pending')` never matched a row. The filter now uses `IS NULL` when "Pending" is selected.
- Notes: No migration or deploy needed — frontend-only change. Audited the other Orders filters (Confirmation, Delivery's other statuses, Product, Sub Status, Courier, Channel) while investigating — all use real, non-null DB values and work correctly. Also confirmed the "Upsell = Yes" filter is a pre-existing dead filter (the app never sets `upsell = true` anywhere) — left as-is per the user's decision, not a new bug.

### 2026-08-25 10:01 - Anwar Bounasser
- Commit: `e98fed0`
- Area: Warehouse / Label Printing
- Change: Added a "Print Picking List" button to the Confirm Label Print dialog (Not Printed tab). It opens an A4-formatted sheet totaling the quantity needed per product across every shipment in the current filtered print batch.
- Reason: Before printing shipping labels, the warehouse team needs a single sheet listing each product and how many units to pull from stock for that batch, instead of reading it off each order individually.
- Notes: No migration or deploy needed — frontend-only change.

### 2026-08-25 07:39 - Anwar Bounasser
- Commit: `31115f7`
- Area: Orders / Edit Order
- Change: The Edit Order modal's product dropdown now fetches the order's actual seller's real product catalog for admin/agent editors, instead of a hardcoded mock list (`productNames` in `src/lib/data.ts` — leftover demo data like "Ceramic Tagine", "Berber Rug").
- Reason: When an admin/agent edited an order and tried to change its product, the dropdown showed unrelated fake demo products that don't exist in the seller's real catalog.
- Notes: No migration or deploy needed — frontend-only change. Added `sellerId` to the `Order` type (`src/lib/data.ts`) and threaded it through the Orders page mapping so `EditOrderModal` can scope the products query correctly.

### 2026-08-25 06:21 - Anwar Bounasser
- Commit: `6e978b8`
- Area: Dashboard / Team Status
- Change: The Team Status panel now includes Warehouse Manager and WhatsApp Manager roles (badges "WH" and "WA"), previously only agent/admin/follow_up were queried.
- Reason: Warehouse and WhatsApp managers were invisible in the online/offline team widget even when active.
- Notes: No migration or deploy needed — frontend-only change. Verified live against `user_presence` data that both roles now compute the correct online/idle/offline status.

### 2026-08-24 21:52 - Anwar Bounasser
- Commit: `323cf74`
- Area: Delivery Analytics
- Change: Reworked Delivery Analytics status KPI counts so Updated-mode delivery stages use delivery-status history events, Failed Attempt counts only real transitions into `failed_attempt`, Returned counts only real transitions into `return_received`, and Delivered uses the `delivered_at` timestamp for actual delivered orders.
- Reason: The Yesterday/Updated view was showing inflated or misleading status counts because some cards were based on current status plus `updated_at`, while others needed exact status-change timing.
- Notes: Frontend-only change. `npm run build` passed with existing Browserslist, Tailwind ambiguous duration, CSS import order, and chunk-size warnings.

### 2026-08-24 15:43 - Anwar Bounasser
- Commit: `7057000`
- Area: Follow Ups
- Change: Added a "Delivery Company" (courier) filter dropdown to the Follow Ups page toolbar, next to the existing Delivery status filter.
- Reason: With two active couriers (PostEx and M&P), the follow-up team needs to filter the queue down to one courier's orders.
- Notes: No migration or deploy needed — frontend-only change.

### 2026-08-24 13:45 - Anwar Bounasser
- Commit: `6c95264`
- Area: Warehouse
- Change: Added a product filter and row selection to the Out of Stock tab, plus a "Print list" action that opens a printable customer contact sheet (order, customer name, phone, city, address, product, quantity, amount) for the selected orders.
- Reason: When a product runs out of stock for multiple orders at once, the warehouse team needs to hand confirmation agents a list of affected customers so they can re-confirm the order before a restock happens.
- Notes: No migration or deploy needed — frontend-only change.

### 2026-08-24 10:26 - Adil
- Commit: `fe29c04`
- Area: Shipping / M&P City Aliases
- Change: Updated the M&P city sync to preserve existing city aliases during cache refreshes and restored all M&P aliases with carrier-scoped SQL.
- Reason: The M&P city refresh deletes and reloads the cache; without preserving aliases, manual mappings disappear after a refresh.
- Notes: Migration `20260824100500_restore_mnp_aliases_scoped.sql` was applied live to Supabase and `mnp-shipping-sync` was deployed. The scoped migration also removes these M&P aliases from non-M&P carrier cache rows.

### 2026-08-24 09:56 - Adil
- Commit: `db700ab`
- Area: Shipping / Carrier Configuration UI
- Change: Added a mapped alias table to City Coverage and improved the Fallbacks tab with search and suggested carrier city matches for manual alias mapping.
- Reason: The team needs to see which carrier city aliases already exist and which unmatched fallback cities still need manual review.
- Notes: No database data was changed by this UI update. `npm run build` passed with existing CSS, Browserslist, and bundle-size warnings.

### 2026-08-24 09:51 - Adil
- Commit: `fbefd99`
- Area: Shipping / Carrier Routing
- Change: Added additional M&P city aliases for highly likely spelling variants: `BUNER DISTRICT` -> `BUNER`, `BAHAWALNAGAR` -> `BAWALNAGAR`, `CHARSADDA` -> `CHARSADA`, `ABBOTTABAD` -> `ABOTTABAD`, `SWAT` -> `SWAT (MINGORA CITY)`, `DERA ISMAIL KHAN` -> `D.I. KHAN`, and `ABDUL HAKEEM` -> `ABDUL HAKIM /TULAMBA`.
- Reason: These destinations appear to be supported by M&P under different spellings, so future orders should route to M&P instead of falling back to PostEx.
- Notes: Migration `20260824095100_add_more_mnp_city_aliases.sql` was applied live to Supabase. Ambiguous cities such as `Kulachi`, `Bela`, `Jamshoro`, `MALAKAND`, `Digri`, `Minchinabad`, and `Turbat` were intentionally not mapped.

### 2026-08-24 09:25 - Adil
- Commit: `978569d`
- Area: Shipping / Carrier Routing
- Change: Added M&P city aliases for `DERA GHAZI KHAN` -> `D.G. KHAN` and `BAHAWALPUR` -> `BHAWALPUR`.
- Reason: M&P supports these destinations under different spellings, so orders should route to M&P instead of falling back to PostEx.
- Notes: Migration `20260824103000_add_mnp_city_aliases.sql` was applied live to Supabase.

### 2026-08-24 09:05 - Adil
- Commit: `51bbc87`
- Area: Shipping / Carrier Routing
- Change: Added carrier city aliases and unmatched-city logging. The carrier router now matches destination cities against both `city_name` and `aliases`, logs fallback cases to `carrier_city_unmatched`, and the Carrier Configuration page shows unresolved city fallbacks with an action to add the input city as an alias.
- Reason: M&P may use different city spellings, for example `SARGODAH` while imported orders use `Sargodha`. Without aliases, those orders fall back to PostEx even when M&P can serve the city.
- Notes: Migration `20260824085000_carrier_city_aliases_unmatched.sql` was applied and `carrier-shipping-sync` was deployed. Existing M&P city `SARGODAH` now has alias `SARGODHA`.

### 2026-08-24 08:40 - Adil
- Commit: `9c0a35b`
- Area: M&P Shipping / Tracking
- Change: M&P status `Out-For-Delivery` is now correctly recognized as `out_for_delivery` instead of being incorrectly mapped to `delivered`.
- Reason: M&P sends this status with hyphens. The previous normalization only recognized `out for delivery` with spaces.
- Notes: Functions `mnp-carrier-status-sync` and `mnp-shipping-sync` were deployed. Existing incorrectly marked orders should be corrected on the next M&P status sync.

### 2026-08-24 08:30 - Adil
- Commit: `9bb261b`
- Area: Documentation / Team Workflow
- Change: Created `DEVELOPMENT_CHANGELOG.md` as the team changelog and populated it with existing Git changes.
- Reason: The three developers need a readable overview of who changed what and when.
- Notes: This document is not updated automatically. Developers must maintain it when pushing changes.

### 2026-08-23 15:22 - Adil
- Commit: `966d044`
- Area: M&P Shipping
- Change: Retried and adjusted M&P destination-reached status sync.

### 2026-08-23 15:18 - Adil
- Commit: `f0ac369`
- Area: M&P Shipping
- Change: Kept the M&P substatus `Destination Reached` visible.

### 2026-08-23 15:15 - Adil
- Commit: `9432aba`
- Area: M&P Shipping
- Change: Mapped M&P status `Destination Reached` internally to `shipped`.

### 2026-08-23 15:08 - Anwar Bounasser
- Commit: `b346d75`
- Area: WhatsApp / Shipping
- Change: Use the M&P-specific shipped template for M&P shipments.

### 2026-08-23 13:41 - Adil
- Commit: `6418537`
- Area: M&P Tracking
- Change: Read wrapped M&P tracking responses correctly.

### 2026-08-23 13:36 - Adil
- Commit: `f73a136`
- Area: M&P Tracking
- Change: Support M&P tracking array responses.

### 2026-08-23 13:32 - Adil
- Commit: `3cf897e`
- Area: M&P Tracking
- Change: Fixed M&P tracking status updates.

### 2026-08-23 13:26 - Adil
- Commit: `efdbb4a`
- Area: M&P Labels / Status Sync
- Change: Fixed M&P label and status sync logic.

### 2026-08-22 15:04 - Anwar Bounasser
- Commit: `26ef559`
- Area: Orders
- Change: Added a courier filter to the admin Orders page.

### 2026-08-22 13:07 - Anwar Bounasser
- Commit: `8bf3f0b`
- Area: Warehouse
- Change: Added a delivery courier filter to Not Printed, Ready to Dispatch, and Out of Stock.

### 2026-08-22 11:47 - Anwar Bounasser
- Commit: `d61c7ca`
- Area: WhatsApp Inbox
- Change: Show the assigned Follow-up Agent in the order card.

### 2026-08-22 10:22 - Anwar Bounasser
- Commit: `af83159`
- Area: Follow Ups
- Change: Excluded already-returned orders from the stale re-attempt warning.

### 2026-08-22 10:13 - Anwar Bounasser
- Commit: `916ae7b`
- Area: Follow Ups
- Change: Flag stale re-attempted orders and pin them to the top.

### 2026-08-21 20:58 - Adil
- Commit: `41d57b8`
- Area: M&P Labels
- Change: Fixed M&P label PDF handling.

### 2026-08-21 20:31 - Adil
- Commit: `6ce6eb6`
- Area: M&P Tracking
- Change: Improved error handling for M&P tracking.

### 2026-08-21 17:45 - Adil
- Commit: `f09682e`
- Area: Shipping Router
- Change: Added carrier fallback routing. If the active carrier does not cover a city, the shipment can fall back to PostEx.

### 2026-08-21 17:31 - Adil
- Commit: `4c13eac`
- Area: Shipping
- Change: Merged M&P carrier routing into `main`.

### 2026-08-21 17:24 - Adil
- Commit: `aac0e20`
- Area: Settings / Carriers
- Change: Added a configuration page for carrier routing.

### 2026-08-21 17:13 - Adil
- Commit: `a85b850`
- Area: M&P Tracking
- Change: Fixed parsing of the M&P tracking response.

### 2026-08-21 17:11 - Adil
- Commit: `fee9ca3`
- Area: M&P Cities
- Change: Fixed parsing of the M&P city response.

### 2026-08-21 11:28 - Anwar Bounasser
- Commit: `4fd9ed3`
- Area: Delivery Analytics
- Change: Reworked Delivery Analytics KPIs to follow the SellerAnalytics event-date pattern and fixed missing `confirmed_at`.

### 2026-08-21 10:26 - Anwar Bounasser
- Commit: `8be7a85`
- Area: Analytics / Dashboard
- Change: Fixed Confirmation Analytics attribution, the dead handling-time metric, and My Dashboard claimed orders.

### 2026-08-21 09:26 - Adil
- Commit: `e7eb0e9`
- Area: Shipping
- Change: Reverted the previous M&P carrier routing and label change.

### 2026-08-21 09:25 - Adil
- Commit: `eacf482`
- Area: Shipping
- Change: Added M&P carrier routing and labels.

### 2026-08-21 08:57 - Anwar Bounasser
- Commit: `cd9ff7c`
- Area: Order Attribution
- Change: Fixed confirmed-order attribution so the user who actually confirmed the order receives credit.

### 2026-08-21 08:23 - Anwar Bounasser
- Commit: `4a68834`
- Area: WhatsApp Inbox
- Change: Show the shipment tracking number in the WhatsApp Inbox order card.

### 2026-08-21 07:58 - Anwar Bounasser
- Commit: `dbce1ae`
- Area: WhatsApp Inbox / Follow Up
- Change: Added combinable Stage/Refine filters and a Follow Up overview stat.

### 2026-08-20 15:54 - Anwar Bounasser
- Commit: `54f2d05`
- Area: Follow Up
- Change: Scoped the Follow Up badge/filter to `failed_attempt` instead of `shipped`.

### 2026-08-20 15:43 - Anwar Bounasser
- Commit: `fb33485`
- Area: AI / WhatsApp
- Change: Prevented the AI from reopening the address flow on already-shipped orders through stale buttons.

### 2026-08-20 14:28 - Anwar Bounasser
- Commit: `68b9542`
- Area: Manual Orders
- Change: Added phone number validation for manual order creation.
