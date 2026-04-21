DROP FUNCTION IF EXISTS public.get_follow_ups_data();

CREATE OR REPLACE FUNCTION public.get_follow_ups_data()
RETURNS TABLE (
  order_id TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  customer_city TEXT,
  delivery_status TEXT,
  shipping_status TEXT,
  orio_order_id INTEGER,
  orio_consignment_no TEXT,
  shipped_at TIMESTAMP WITH TIME ZONE,
  days_since_shipped INTEGER,
  follow_up_status TEXT,
  follow_up_updated_at TIMESTAMP WITH TIME ZONE,
  follow_up_updated_by UUID,
  order_created_at TIMESTAMP WITH TIME ZONE,
  order_updated_at TIMESTAMP WITH TIME ZONE,
  seller_id UUID,
  seller_name TEXT,
  agent_id UUID,
  agent_name TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'agent')) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  WITH shipped_events AS (
    SELECT DISTINCT ON (oh.order_id)
      oh.order_id,
      oh.created_at AS shipped_at
    FROM public.order_history oh
    WHERE oh.field_changed = 'delivery_status'
      AND oh.new_value = 'shipped'
    ORDER BY oh.order_id, oh.created_at ASC
  )
  SELECT
    o.order_id,
    o.customer_name,
    o.customer_phone,
    o.customer_city,
    o.delivery_status,
    o.shipping_status,
    o.orio_order_id,
    o.orio_consignment_no,
    COALESCE(se.shipped_at, o.orio_synced_at) AS shipped_at,
    CASE
      WHEN COALESCE(se.shipped_at, o.orio_synced_at) IS NULL THEN NULL
      ELSE EXTRACT(DAY FROM (now() - COALESCE(se.shipped_at, o.orio_synced_at)))::INTEGER
    END AS days_since_shipped,
    COALESCE(fu.follow_up_status, 'pending') AS follow_up_status,
    fu.updated_at AS follow_up_updated_at,
    fu.updated_by AS follow_up_updated_by,
    o.created_at AS order_created_at,
    o.updated_at AS order_updated_at,
    o.seller_id,
    sp.name AS seller_name,
    o.agent_id,
    ap.name AS agent_name
  FROM public.orders o
  LEFT JOIN shipped_events se ON se.order_id = o.order_id
  LEFT JOIN public.order_follow_ups fu ON fu.order_id = o.order_id
  LEFT JOIN public.profiles sp ON sp.user_id = o.seller_id
  LEFT JOIN public.profiles ap ON ap.user_id = o.agent_id
  WHERE o.orio_order_id IS NOT NULL
  ORDER BY o.updated_at DESC;
END;
$$;