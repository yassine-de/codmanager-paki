-- Same shape as get_confirmation_status_events(), for delivery_status —
-- lets the Dashboard's Delivery Rate denominator (deliveryPool) in "Updated"
-- mode be event-aware (order_history) instead of falling back to the
-- generic orders.updated_at for every non-delivered status in the shipped
-- pool (shipped/in_transit/failed_attempt/etc), which also moves on
-- unrelated touches.
CREATE OR REPLACE FUNCTION public.get_delivery_status_events()
RETURNS TABLE(order_id text, new_value text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT h.order_id, h.new_value, h.created_at
  FROM public.order_history h
  WHERE h.field_changed = 'delivery_status'
    AND (
      public.is_staff(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.order_id = h.order_id AND o.seller_id = auth.uid()
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_delivery_status_events() TO authenticated;
