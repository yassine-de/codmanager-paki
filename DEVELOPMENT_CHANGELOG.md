# Development Changelog

This document is for the development team. It records which changes were added to the project, when they were added, and who made them.

Source for existing entries: Git history (`git log`). Times are local times from the developer environment.

Last manual update: 2026-08-24 09:25 - Adil

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

### 2026-08-24 09:25 - Adil
- Commit: `503cb9f`
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
