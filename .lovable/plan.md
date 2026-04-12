

# Fix: Cross-Shipped Delivered Revenue Not Counted

## Problem
BS-INV-003 shows $81.02 delivered revenue instead of $147.56. Three orders (BS-007, BS-008, BS-013) that were both cross-shipped AND delivered within INV-003's period are added to the delivered orders list but their revenue ($66.54) is never summed.

## Root Cause
In `get_invoice_summary`, the cross-shipped CTE calculates `v_cross_delivered_orders` (list) but not revenue. The line:
```sql
v_cross_delivered_revenue := v_cross_delivered_only_revenue;
```
Only includes revenue from the "delivered-only" CTE, ignoring delivered orders that came through the "cross-shipped" path.

## Fix (1 migration)

### Add revenue sum to the cross-shipped CTE SELECT INTO

Currently the cross-shipped CTE selects:
```sql
SELECT COUNT(DISTINCT id), jsonb_agg(...), jsonb_agg(...)
INTO v_cross_shipped_count, v_cross_delivered_orders, v_cross_orders
```

Change to also sum delivered revenue:
```sql
SELECT COUNT(DISTINCT id),
  COALESCE(SUM(ROUND(price*quantity/v_pkr_rate,2)) FILTER (WHERE is_delivered_in_period), 0),
  jsonb_agg(...) FILTER (WHERE is_delivered_in_period),
  jsonb_agg(...)
INTO v_cross_shipped_count, v_cross_shipping_delivered_revenue, v_cross_delivered_orders, v_cross_orders
```

Add a new variable `v_cross_shipping_delivered_revenue numeric := 0` and update the revenue aggregation:
```sql
v_cross_delivered_revenue := v_cross_delivered_only_revenue + v_cross_shipping_delivered_revenue;
```

This is a single-line logic fix in the existing function. No frontend changes needed.

## Expected Result
- BS-INV-003: $81.02 + $66.54 = $147.56 delivered revenue
- BS-INV-001 and BS-INV-002: unaffected (no delivered orders in their periods)

