-- Adds a "Postponed" option to the Follow Ups "Update Follow Up" picker:
-- the follow-up agent picks a target date/time to come back to the order,
-- stored on order_follow_ups.fu_postpone_until, and a sweep fires a
-- mandatory notification once that date/time arrives (then re-reminds
-- every 4h while the order stays in "postponed" and unresolved, same
-- repeating-bucket mechanism as the existing followup_stale reminder).

ALTER TABLE public.order_follow_ups ADD COLUMN IF NOT EXISTS fu_postpone_until timestamptz;

-- get_follow_ups_data() needs to surface fu_postpone_until to the frontend.
-- Return type is changing (new output column), so this must be dropped and
-- recreated rather than CREATE OR REPLACE'd.
DROP FUNCTION IF EXISTS public.get_follow_ups_data();
CREATE FUNCTION public.get_follow_ups_data()
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
  WHERE o.delivery_status IN (
    'shipped', 'in_transit', 'out_for_delivery', 'with_courier', 'delivered', 'paid',
    'failed_attempt', 'returned', 'return', 'ready_for_return', 'return_received'
  )
  ORDER BY o.updated_at DESC;
$$;

ALTER TABLE public.follow_up_notifications DROP CONSTRAINT IF EXISTS follow_up_notifications_type_check;
ALTER TABLE public.follow_up_notifications ADD CONSTRAINT follow_up_notifications_type_check
  CHECK (type IN (
    'followup_assigned', 'followup_stale', 'followup_delivered', 'followup_returned',
    'followup_no_answer_attempt', 'followup_reattempt_stale', 'followup_postpone_due'
  ));

CREATE OR REPLACE FUNCTION public.sweep_followup_stale_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_hours_stale integer;
BEGIN
  FOR v_row IN
    SELECT fu.order_id, o.order_id AS display_order_id, o.follow_up_assigned_to, fu.follow_up_status, fu.updated_at
    FROM public.order_follow_ups fu
    JOIN public.orders o ON o.order_id = fu.order_id
    WHERE fu.follow_up_status IN ('no_answer', 'pushed_delivery')
      AND o.follow_up_assigned_to IS NOT NULL
      AND fu.updated_at <= now() - interval '4 hours'
  LOOP
    v_hours_stale := floor(extract(epoch FROM (now() - v_row.updated_at)) / 3600);
    IF v_hours_stale >= 4 AND v_hours_stale % 4 = 0 THEN
      INSERT INTO public.follow_up_notifications (follow_up_user_id, type, title, message, order_id, dedupe_key)
      VALUES (
        v_row.follow_up_assigned_to, 'followup_stale', 'Needs Reattempt',
        'Order ' || v_row.display_order_id || ' has been ' || v_row.follow_up_status || ' for ' || v_hours_stale || 'h — reattempt now',
        v_row.display_order_id, 'followup_stale:' || v_row.display_order_id || ':' || v_hours_stale
      )
      ON CONFLICT (follow_up_user_id, dedupe_key) DO NOTHING;
    END IF;
  END LOOP;

  -- Re-attempted but still not delivered 24h+ later; re-reminds every 24h.
  FOR v_row IN
    SELECT fu.order_id, o.order_id AS display_order_id, o.follow_up_assigned_to, o.delivery_status, fu.updated_at
    FROM public.order_follow_ups fu
    JOIN public.orders o ON o.order_id = fu.order_id
    WHERE fu.follow_up_status = 're_attempted'
      AND o.follow_up_assigned_to IS NOT NULL
      AND COALESCE(o.delivery_status, '') NOT IN ('delivered', 'paid')
      AND fu.updated_at <= now() - interval '24 hours'
  LOOP
    v_hours_stale := floor(extract(epoch FROM (now() - v_row.updated_at)) / 3600);
    IF v_hours_stale >= 24 AND v_hours_stale % 24 = 0 THEN
      INSERT INTO public.follow_up_notifications (follow_up_user_id, type, title, message, order_id, dedupe_key)
      VALUES (
        v_row.follow_up_assigned_to, 'followup_reattempt_stale', 'Still Not Delivered',
        'Order ' || v_row.display_order_id || ' was re-attempted ' || (v_hours_stale / 24) || 'd ago and is still not delivered',
        v_row.display_order_id, 'followup_reattempt_stale:' || v_row.display_order_id || ':' || v_hours_stale
      )
      ON CONFLICT (follow_up_user_id, dedupe_key) DO NOTHING;
    END IF;
  END LOOP;

  -- Postponed order's target date/time has arrived (or passed); fires
  -- immediately when due, then re-reminds every 4h while still postponed
  -- and unresolved so it can't be silently missed.
  FOR v_row IN
    SELECT fu.order_id, o.order_id AS display_order_id, o.follow_up_assigned_to, fu.fu_postpone_until
    FROM public.order_follow_ups fu
    JOIN public.orders o ON o.order_id = fu.order_id
    WHERE fu.follow_up_status = 'postponed'
      AND o.follow_up_assigned_to IS NOT NULL
      AND fu.fu_postpone_until IS NOT NULL
      AND fu.fu_postpone_until <= now()
  LOOP
    v_hours_stale := floor(extract(epoch FROM (now() - v_row.fu_postpone_until)) / 3600);
    IF v_hours_stale % 4 = 0 THEN
      INSERT INTO public.follow_up_notifications (follow_up_user_id, type, title, message, order_id, dedupe_key)
      VALUES (
        v_row.follow_up_assigned_to, 'followup_postpone_due', 'Postponed Follow-Up Due',
        'Order ' || v_row.display_order_id || ' — the postponed date has arrived, follow up now',
        v_row.display_order_id, 'followup_postpone_due:' || v_row.display_order_id || ':' || v_hours_stale
      )
      ON CONFLICT (follow_up_user_id, dedupe_key) DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
