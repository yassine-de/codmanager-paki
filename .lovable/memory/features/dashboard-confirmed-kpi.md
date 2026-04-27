---
name: Dashboard Confirmed KPI
description: Confirmed KPI counts every order whose confirmation event happened in the period, including those that moved on to booked/shipped/delivered.
type: feature
---

The Dashboard "Confirmed" KPI and the Confirmed line in the daily chart count
every order that reached the confirmed stage during the selected period —
regardless of whether the order has since moved on to a downstream delivery
status (booked, shipped, in_transit, with_courier, delivered, paid, returned).

**Filter formula** (in `src/hooks/useDashboardData.ts`):
```
confirmed =
  confirmation_status === 'confirmed'
  OR delivery_status ∈ {booked, shipped, in_transit, with_courier, delivered, paid, returned}
```

**Why:** The earlier logic counted only `confirmation_status === 'confirmed'`,
so an order confirmed by an agent or by WhatsApp AI that an agent later marked
as Shipped/Booked silently dropped out of "Confirmed today". This made the KPI
underreport actual confirmation activity.

**Date bucketing:** Filtering still uses `getTreatmentDate(o)` which prefers
`confirmed_at` for confirmed orders. Combined with the new filter, every order
confirmed on day X is counted on day X regardless of channel (agent / WhatsApp)
or current shipping state.

Applies to both `computeKPIs` and `computeDailyData`.
