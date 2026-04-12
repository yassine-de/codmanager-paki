

# Fix: Delivered Orders Appearing in Closed Invoices

## Problem
BS-INV-001 (finalized at 14:23) shows 5 delivered orders with revenue, but all 5 were delivered at 14:51 — **after** the invoice was closed. The function uses the order's **current** `delivery_status` column instead of checking when the delivery event actually occurred.

## Affected Locations (4 places in `get_invoice_summary`)

1. **`v_delivered_count`** — `WHERE o.delivery_status = 'delivered'` with no time check
2. **`v_delivered_revenue_usd`** — same: sums revenue from currently-delivered orders regardless of timing
3. **Delivered orders CTE** — builds the delivered orders list using current status
4. **All orders CTE → `was_delivered`** — checks if order was ever delivered, not if it was delivered within the period

## Fix (1 migration)

Add an `EXISTS` check on `order_history` to each location, requiring the delivery event to fall within `v_period_start` and `v_period_end`.

### Location 1: `v_delivered_count`
```sql
SELECT COUNT(DISTINCT o.id) INTO v_delivered_count
FROM public.orders o
WHERE o.invoice_id = p_invoice_id
  AND o.delivery_status = 'delivered'
  AND EXISTS (
    SELECT 1 FROM public.order_history oh
    WHERE oh.order_id = o.order_id
      AND oh.field_changed = 'delivery_status'
      AND oh.new_value = 'delivered'
      AND oh.created_at > v_period_start
      AND oh.created_at <= v_period_end
  );
```

### Location 2: `v_delivered_revenue_usd`
Same `EXISTS` filter added.

### Location 3: Delivered orders CTE
Same `EXISTS` filter in the `WHERE` clause.

### Location 4: `was_delivered` in all orders CTE
Time-bound the `EXISTS` check:
```sql
(o.delivery_status = 'delivered' AND EXISTS (
  SELECT 1 FROM public.order_history oh
  WHERE oh.order_id = o.order_id
    AND oh.field_changed = 'delivery_status'
    AND oh.new_value = 'delivered'
    AND oh.created_at > v_period_start
    AND oh.created_at <= v_period_end
)) AS was_delivered
```

## Result
- BS-INV-001 will show 0 delivered, $0 revenue (correct — all deliveries happened after close)
- The cross-invoice logic in the open invoice already picks these up correctly
- No frontend changes needed

