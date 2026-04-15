

## Fix: Agent City Selector Not Showing All Cities

### Problem
The **Agent Orders page** (`AgentOrders.tsx`) uses a **hardcoded list of ~20 cities** (`PAKISTANI_CITIES` array) instead of the `useOrioCities` hook that fetches all 1,351 cities from the `orio_cities_cache` table. The Admin's Edit Order modal works correctly because it uses the `CitySelect` component backed by the database.

### Solution
Replace the hardcoded `PAKISTANI_CITIES` city selector in `AgentOrders.tsx` with the existing `CitySelect` component (or directly use the `useOrioCities` hook).

### Steps

1. **Remove the hardcoded `PAKISTANI_CITIES` array** from `AgentOrders.tsx`
2. **Replace the inline city Popover/Command** (lines ~962-980) with the reusable `CitySelect` component, passing `editCustomer.city` and updating via `setEditCustomer`
3. **Import** `CitySelect` from `@/components/CitySelect`
4. Same change for the read-only city display — no change needed there since it just shows `editCustomer.city`

This is a straightforward swap — one file change, no database or RLS modifications needed.

