-- Fixes a regression in the previous migration (20260819100000): the
-- "delivered" branch correctly kept an order visible once follow-up had
-- actually worked it (follow_up_status <> 'pending'), but the
-- shipped/in_transit/out_for_delivery/with_courier branch had no such
-- escape hatch — an order a follow-up agent had already treated (e.g.
-- marked no_answer) while still under 2 days old silently vanished from
-- the queue and could never be counted again, undercounting "Treated
-- Today" and the agent's totals. Confirmed live before this fix: order
-- HG-8 (shipped_at 2026-08-17, follow_up_status='no_answer') was already
-- excluded despite being real, worked-on activity.
--
-- Fix: a shipped-family order stays visible if EITHER it's aged 2+ days
-- (worth surfacing even if still untouched) OR it's already been treated
-- (real work happened, must never disappear regardless of age).

CREATE OR REPLACE FUNCTION public.get_follow_ups_data()
RETURNS TABLE(
  order_id text, customer_name text, customer_phone text, customer_city text,
  delivery_status text, shipping_status text, shipping_company text, shipment_id uuid,
  tracking_number text, shipped_at timestamptz, days_since_shipped integer,
  follow_up_status text, follow_up_updated_at timestamptz, follow_up_updated_by uuid,
  order_created_at timestamptz, order_updated_at timestamptz, seller_id uuid, seller_name text,
  agent_id uuid, agent_name text, follow_up_assigned_to uuid, follow_up_note text,
  product_name text, total_amount numeric, fu_no_answer_count integer, fu_postpone_until timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.order_id, o.customer_name, o.customer_phone, o.customer_city, o.delivery_status,
    COALESCE(s.carrier_status, o.shipping_status) AS shipping_status,
    COALESCE(c.name, o.shipping_company) AS shipping_company,
    s.id AS shipment_id, s.tracking_number,
    COALESCE(o.shipped_at, s.booked_at) AS shipped_at,
    CASE WHEN COALESCE(o.shipped_at, s.booked_at) IS NOT NULL
      THEN GREATEST(0, EXTRACT(DAY FROM (now() - COALESCE(o.shipped_at, s.booked_at)))::integer)
      ELSE NULL
    END AS days_since_shipped,
    COALESCE(fu.follow_up_status, 'pending'),
    fu.updated_at, fu.updated_by, o.created_at, o.updated_at,
    o.seller_id, sp.name, o.agent_id, ap.name, o.follow_up_assigned_to, o.follow_up_note,
    o.product_name, o.total_amount,
    COALESCE(fu.fu_no_answer_count, 0)::integer,
    fu.fu_postpone_until
  FROM public.orders o
  LEFT JOIN public.order_follow_ups fu ON fu.order_id = o.order_id
  LEFT JOIN LATERAL (
    SELECT sh.* FROM public.shipments sh
    WHERE sh.order_uuid = o.id ORDER BY sh.created_at DESC, sh.id DESC LIMIT 1
  ) s ON true
  LEFT JOIN public.carriers c ON c.id = s.carrier_id
  LEFT JOIN public.profiles sp ON sp.user_id = o.seller_id
  LEFT JOIN public.profiles ap ON ap.user_id = o.agent_id
  WHERE (
    o.delivery_status IN ('failed_attempt', 'returned', 'return', 'ready_for_return', 'return_received')
    OR (
      o.delivery_status IN ('shipped', 'in_transit', 'out_for_delivery', 'with_courier')
      AND (
        (fu.follow_up_status IS NOT NULL AND fu.follow_up_status <> 'pending')
        OR (
          COALESCE(o.shipped_at, s.booked_at) IS NOT NULL
          AND COALESCE(o.shipped_at, s.booked_at) <= now() - interval '2 days'
        )
      )
    )
    OR (
      o.delivery_status IN ('delivered', 'paid')
      AND fu.follow_up_status IS NOT NULL
      AND fu.follow_up_status <> 'pending'
    )
  )
  ORDER BY o.updated_at DESC;
$$;

NOTIFY pgrst, 'reload schema';
