# Development Changelog

This document is for the development team. It records which changes were added to the project, when they were added, and who made them.

Source for existing entries: Git history (`git log`). Times are local times from the developer environment.

Last manual update: 2026-09-03 07:04 - Anwar Bounasser

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

### 2026-09-03 07:04 - Anwar Bounasser
- Commit: `7b986b0`
- Area: Warehouse
- Change: Fixed the scan success/error beep never being audible. It was started inside `performDispatch`, which runs after `await`ing the dispatch RPC — by then the browser no longer treats it as inside the original user gesture, so `AudioContext.resume()` stayed silently suspended. Added `ensureScanAudioUnlocked()`, called synchronously from the real click/submit handlers (Scan form submit, camera button, Auto Dispatch toggle) so the AudioContext starts running while still inside the gesture; the later async beep now actually plays.
- Reason: Reported the scan flow worked (dispatch + camera scan both fine after the earlier crash fix) but no sound was ever heard on scan.
- Notes: No migrations. Verified clean `tsc --noEmit` and clean dev server logs; audio playback itself can't be verified from this environment (no speaker/audio capture here), asked Anwar to re-test live.

### 2026-09-03 06:52 - Anwar Bounasser
- Commit: `32424fd`
- Area: Warehouse
- Change: Fixed the new camera QR/barcode scanner (`QrScannerDialog`, added earlier today) crashing the entire app to a blank page when the camera failed to initialize. `html5-qrcode`'s constructor throws a raw string synchronously if its target DOM element isn't ready yet, which wasn't caught — an uncaught error with no error boundary anywhere in this app unmounts the whole React tree. Wrapped the whole start sequence in try/catch and added a short retry loop that waits for the target element before constructing the scanner.
- Reason: Reported clicking the camera button showed a fully black page (no dialog, no title, no cancel button) instead of a normal error — traced to this uncaught synchronous exception rather than a permissions/camera issue.
- Notes: No migrations. Verified clean `tsc --noEmit` and clean dev server/build logs; could not reproduce the live camera failure directly (no camera in this environment) so asked Anwar to re-test. Flagged separately (not fixed here, out of scope) that this app has zero React error boundaries anywhere — any future uncaught error in any component will still blank the whole page the same way; a background task was queued for that as a follow-up.

### 2026-09-03 06:45 - Anwar Bounasser
- Commit: `4b8a52d`
- Area: Warehouse
- Change: Added camera-based QR/barcode scanning to the Ready to Dispatch and Returns scan inputs (new `QrScannerDialog` component, `html5-qrcode`) so a phone camera can scan the courier's own ticket QR instead of relying on a hardware scanner reading the printed barcode. Added an "Auto Dispatch" toggle on Ready to Dispatch: when on, a recognized scan dispatches the order immediately with no confirm dialog, and plays an audible beep on success / buzz on failure (Web Audio API, no asset files) so the scanning operator gets feedback without watching the screen.
- Reason: Reported that PostEx's printed barcode is sometimes visually compressed/hard to scan; the courier's ticket already carries a clean QR with the tracking number, so the fix was to let warehouse staff scan that QR from a phone camera instead. The Auto Dispatch mode + sound was a follow-up request to make continuous scanning during dispatch faster, without a confirm click per order.
- Notes: An earlier version of this change also generated and printed our own QR ticket per order — removed after confirmation that it was redundant (courier's ticket already has a working QR). `qrcode` npm package added then removed for the same reason; `html5-qrcode` is the only new runtime dependency. No DB/migration changes — the scanned QR value is matched against `order_id`/`tracking_number`/`system_id` using the exact same lookup already used by manual scan input. Verified: clean `tsc --noEmit`, clean `eslint` (no new issues beyond the file's pre-existing `any` usage), clean dev server + browser console. Could not verify the live camera scan / audio / auto-dispatch flow directly — needs an authenticated session and a real camera, both unavailable in this environment; asked Anwar to test live.

### 2026-09-02 07:31 - Anwar Bounasser
- Commit: `75cf2b4`
- Area: Orders / Integrations / Database
- Change: Added UTM source tracking. `import-sheets` now reads a "UTM Source" column (default L, configurable per sheet in Integrations' Column Mapping) from each seller's Google Sheet and stores it on `orders.source_ref`. Manually-created orders from an agent are tagged `source_ref = 'Agent Created'`. Added a "UTM Source" filter + column to the admin Orders page.
- Reason: Admin needed to see which channel (Facebook/TikTok ads, or an agent typing the order in directly) each order actually came from — the sheet already had this data per order, it just wasn't being captured.
- Notes: Migrations `20260902110000_capture_utm_from_sheet_import.sql` and `20260902120000_tag_agent_created_orders_source.sql` applied live; `import-sheets` deployed. `orders.source_ref` was an existing, previously-unused column, reused for this rather than adding a new one — cleared 23 stale unrelated values (old debug/test markers like `duplicated_from:X`, `mnp-label-test-...`) that predated this reuse so the new filter only shows real sources. Verified live: a real order (AB-3082) came through the sheet import with `source_ref='facebook'` correctly captured right after deploy.

### 2026-08-31 12:42 - Anwar Bounasser
- Commit: `beeb902`
- Area: WhatsApp Automations
- Change: Added a "Sub Status" filter (multi-select) to the "Delivery Status Changed" trigger, matched against `orders.shipping_status` (raw carrier text like "Out-for-Delivery"), usable alongside or instead of the existing "Becomes" delivery-status filter. Since `shipping_status` changes aren't logged to `order_history` (unlike `delivery_status`), added a separate polling sweep (`sweepSubStatusChanges`) so automations relying on sub-status alone still fire.
- Reason: Requested to trigger the new "Out for Delivery" WhatsApp template specifically when the carrier sub-status becomes "Out-for-Delivery" — the coarse delivery_status often doesn't change at that moment, so the existing "Becomes" filter alone couldn't express this.
- Notes: Deployed `whatsapp-automation-runner` (twice — once for the initial single-value version, once after switching to multi-select). Verified live end-to-end: created a temporary test automation, invoked the function directly against a real order with a matching `shipping_status` (fired correctly, run completed) and one with a non-matching value (correctly did not fire), then deleted the test automation and its run — no real customer message was sent.

### 2026-08-31 10:56 - Anwar Bounasser
- Commit: `bedf833`
- Area: Invoices / Database
- Change: Fixed "Failed to finalize invoice" — the `notify_seller_invoice_ready` trigger built its notification message with `... || NEW.period_start || ... || NEW.period_end || ...`; since every invoice auto-created by the finalize flow starts with a NULL period, the whole concatenation collapsed to NULL and violated `seller_notifications.message`'s NOT NULL constraint, rolling back the entire invoice UPDATE. Also hardened `notify_admin_invoice_payout_due` against a NULL `net_payable` the same way.
- Reason: Admin reported every invoice finalize attempt failing. Root cause confirmed live by reproducing the exact Postgres error (23502 NOT NULL violation) on a real invoice (HG-INV-001), then re-testing successfully after the fix.
- Notes: Migration `20260831100000_fix_invoice_finalize_null_period.sql` applied live to Supabase. No invoice calculation logic (subtotal/fees/net_payable) was touched — only how the notification message text is built when period_start/period_end are unset.

### 2026-08-28 15:04 - Anwar Bounasser
- Commit: `c0fcfcf`
- Area: Follow Ups / Database
- Change: Switched the follow-up auto-assignment function (`assign_follow_up_agent_for_order`) from load-based ordering to pure round-robin (whichever eligible agent was assigned an order longest ago wins the next one).
- Reason: The old load-based ordering picked the agent with the lowest lifetime assigned-order count, which almost never decreases (delivered/returned orders still count), so once one agent built a historical lead the other got 0% of new assignments for an extended stretch — confirmed live: all 491 orders assigned in the last 7 days went to a single agent (MEERAB got none).
- Notes: Migration `20260828150000_follow_up_round_robin_assignment.sql` applied live to Supabase. Verified end-to-end on a real order (temporarily unassigned, re-ran the function, confirmed it picked the other agent, then restored the original assignment — no live data left altered). Did not touch the 598 already-unassigned backlog orders (599 pre-date both current agents' `assignment_started_at` gate by design; 597 of those are already delivered/returned and don't need follow-up).

### 2026-08-28 15:04 - Anwar Bounasser
- Commit: `6b94684`
- Area: Follow Ups
- Change: Fixed the "FU Updated" date filter, which was falling back to `order_updated_at` for orders with no `order_follow_ups` row, flooding results with orders Follow Up never actually touched.
- Reason: Live-verified 37% of "FU Updated today" matches (57 of 154) were this fallback noise, not real follow-up activity — defeats the purpose of using this filter to audit what Follow Up did on a given day.
- Notes: No migration or deploy needed — frontend-only change.

### 2026-08-28 14:11 - Anwar Bounasser
- Commit: `d3d2215`
- Area: Orders / Edit Order
- Change: The admin "Edit Order" modal now sets `delivered_at`/`confirmed_at` when it changes delivery_status to "delivered" or confirmation_status to "confirmed" — it was previously only updating the status column itself.
- Reason: Orders edited this way silently disappeared from every `delivered_at`/`confirmed_at`-based analytics chart (Dashboard's Delivered sparkline, Delivery/Seller Analytics' Updated mode) even though their status genuinely changed — found live via AB-2772, which an admin marked delivered but never appeared in the Delivered sparkline.
- Notes: No migration or deploy needed — frontend-only change. Backfilled `delivered_at` for the 2 live orders already affected (AB-2772, AB-2302) using their `order_history` delivery_status-change timestamp as evidence.

### 2026-08-28 14:11 - Anwar Bounasser
- Commit: `9db79cb`
- Area: Agent Orders
- Change: The agent-facing "Call" button on the confirmation screen now triggers a real `tel:` navigation instead of only copying the phone number to the clipboard (still copies it too, as a fallback).
- Reason: Agent asked for a way to call the customer directly from the PC without retyping the number. A `tel:` link hands off to whatever calling app is registered on the PC (e.g. Windows Phone Link paired with the agent's phone) — this only works if such an app is set up locally, it's not a full VOIP/click-to-call integration.
- Notes: No migration or deploy needed — frontend-only change.

### 2026-08-28 11:05 - Anwar Bounasser
- Commit: `3b97abc`
- Area: Orders
- Change: Added an admin-only "Updated At" date range filter to the Orders page filter panel, next to Date Range (created) and Delivered At.
- Reason: Admin needed to filter orders by when they were last updated, not just when they were created or delivered.
- Notes: No migration or deploy needed — frontend-only change. Verified the PKT date-boundary logic against live data (SQL count vs. the exact REST query the frontend sends both returned 325 for "Today").

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
