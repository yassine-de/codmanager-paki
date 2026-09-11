-- Narrow, purpose-built read of confirmation_status change events, so the
-- Dashboard's "Updated" basis can be event-aware (order_history, not the
-- generic updated_at) for sellers too, without opening the full order_history
-- audit log (old_value, changed_by, other field types) to seller accounts —
-- only field_changed='confirmation_status' and 3 columns are exposed, and a
-- seller only sees rows for their own orders (mirrors "Sellers view own
-- orders" on the orders table itself).
CREATE OR REPLACE FUNCTION public.get_confirmation_status_events()
RETURNS TABLE(order_id text, new_value text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT h.order_id, h.new_value, h.created_at
  FROM public.order_history h
  WHERE h.field_changed = 'confirmation_status'
    AND (
      public.is_staff(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.order_id = h.order_id AND o.seller_id = auth.uid()
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_confirmation_status_events() TO authenticated;
