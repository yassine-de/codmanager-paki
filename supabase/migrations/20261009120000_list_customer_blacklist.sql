-- Full blacklist for the admin Blacklist page: manual entries + auto matches
-- (>= 2 returned orders and 0 delivered), minus customers cleared by an admin.
-- Same rule as get_customer_blacklist_status / is_customer_blacklisted.
CREATE OR REPLACE FUNCTION public.list_customer_blacklist()
RETURNS TABLE (
  phone_key text,
  phone text,
  customer_name text,
  total_orders integer,
  returned_count integer,
  delivered_count integer,
  last_order_at timestamptz,
  source text,
  reason text,
  updated_at timestamptz,
  updated_by_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'general_manager')) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH stats AS (
    SELECT
      o.customer_phone_normalized AS phone_key,
      count(*)::int AS total_orders,
      count(*) FILTER (WHERE o.delivery_status IN ('return', 'returned', 'ready_for_return', 'return_received'))::int AS returned_count,
      count(*) FILTER (WHERE o.delivery_status IN ('delivered', 'paid'))::int AS delivered_count,
      max(o.created_at) AS last_order_at,
      (array_agg(o.customer_phone ORDER BY o.created_at DESC))[1] AS phone,
      (array_agg(o.customer_name ORDER BY o.created_at DESC))[1] AS customer_name
    FROM public.orders o
    WHERE coalesce(o.customer_phone_normalized, '') <> ''
    GROUP BY o.customer_phone_normalized
  ),
  keys AS (
    SELECT s.phone_key FROM stats s WHERE s.returned_count >= 2 AND s.delivered_count = 0
    UNION
    SELECT b.phone_key FROM public.customer_blacklist b WHERE b.status = 'blacklisted'
  )
  SELECT
    k.phone_key,
    coalesce(s.phone, b.phone_display, k.phone_key),
    s.customer_name,
    coalesce(s.total_orders, 0),
    coalesce(s.returned_count, 0),
    coalesce(s.delivered_count, 0),
    s.last_order_at,
    CASE WHEN b.status = 'blacklisted' THEN 'manual' ELSE 'auto' END,
    b.reason,
    b.updated_at,
    p.name
  FROM keys k
  LEFT JOIN stats s ON s.phone_key = k.phone_key
  LEFT JOIN public.customer_blacklist b ON b.phone_key = k.phone_key
  LEFT JOIN public.profiles p ON p.user_id = b.updated_by
  WHERE coalesce(b.status, '') <> 'cleared'
  ORDER BY coalesce(b.updated_at, s.last_order_at) DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.list_customer_blacklist() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_customer_blacklist() TO authenticated;
