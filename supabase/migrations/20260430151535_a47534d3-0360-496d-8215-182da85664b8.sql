CREATE OR REPLACE FUNCTION public.get_follow_ups_data()
 RETURNS TABLE(
  order_id text,
  customer_name text,
  customer_phone text,
  customer_city text,
  delivery_status text,
  shipping_status text,
  orio_order_id bigint,
  orio_consignment_no text,
  shipped_at timestamp with time zone,
  days_since_shipped integer,
  follow_up_status text,
  follow_up_updated_at timestamp with time zone,
  follow_up_updated_by uuid,
  order_created_at timestamp with time zone,
  order_updated_at timestamp with time zone,
  seller_id uuid,
  seller_name text,
  agent_id uuid,
  agent_name text,
  follow_up_assigned_to uuid,
  follow_up_note text,
  product_name text,
  total_amount numeric
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.is_admin(v_uid);
  v_is_followup boolean := public.has_role(v_uid, 'follow_up'::app_role);
  v_is_agent boolean := public.has_role(v_uid, 'agent'::app_role);
BEGIN
  IF NOT (v_is_admin OR v_is_agent OR v_is_followup) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    o.order_id,
    o.customer_name,
    o.customer_phone,
    o.customer_city,
    o.delivery_status,
    COALESCE(o.orio_shipping_status, o.shipping_status) AS shipping_status,
    o.orio_order_id::bigint AS orio_order_id,
    o.orio_consignment_no,
    o.orio_synced_at AS shipped_at,
    CASE
      WHEN o.orio_synced_at IS NOT NULL
      THEN GREATEST(0, EXTRACT(DAY FROM (now() - o.orio_synced_at))::integer)
      ELSE NULL
    END AS days_since_shipped,
    COALESCE(fu.follow_up_status, 'pending') AS follow_up_status,
    fu.updated_at AS follow_up_updated_at,
    fu.updated_by AS follow_up_updated_by,
    o.created_at AS order_created_at,
    o.updated_at AS order_updated_at,
    o.seller_id,
    sp.name AS seller_name,
    o.agent_id,
    ap.name AS agent_name,
    o.follow_up_assigned_to,
    o.follow_up_note,
    o.product_name,
    o.total_amount
  FROM public.orders o
  LEFT JOIN public.order_follow_ups fu ON fu.order_id = o.order_id
  LEFT JOIN public.profiles sp ON sp.user_id = o.seller_id
  LEFT JOIN public.profiles ap ON ap.user_id = o.agent_id
  WHERE o.delivery_status IN (
    'shipped','in_transit','out_for_delivery','with_courier',
    'delivered','failed_attempt','returned','return','ready_for_return'
  )
  AND (
    v_is_admin
    OR (v_is_followup AND o.follow_up_assigned_to = v_uid)
    OR (v_is_agent AND o.agent_id = v_uid)
  )
  ORDER BY o.updated_at DESC;
END;
$function$;