-- Add shipped_at column to orders: set once when delivery_status first becomes
-- 'shipped', never updated again. This fixes the days_since_shipped calculation
-- in get_follow_ups_data which was incorrectly using orio_synced_at (which
-- gets updated on every OR sync, including out_for_delivery → shows 0 days).

-- 1. Add column
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shipped_at timestamptz;

-- 2. Backfill from order_history (MIN timestamp when status became 'shipped')
UPDATE public.orders o
SET shipped_at = (
  SELECT MIN(oh.created_at)
  FROM public.order_history oh
  WHERE oh.order_id = o.order_id
    AND oh.field_changed = 'delivery_status'
    AND oh.new_value = 'shipped'
)
WHERE o.shipped_at IS NULL
  AND o.delivery_status IN (
    'shipped','in_transit','out_for_delivery','with_courier',
    'delivered','failed_attempt','returned','return','ready_for_return'
  );

-- 3. For shipped orders still without shipped_at (no history entry, e.g. direct
--    ORIO sync), fall back to updated_at as a best-effort approximation.
UPDATE public.orders
SET shipped_at = updated_at
WHERE shipped_at IS NULL
  AND delivery_status IN (
    'shipped','in_transit','out_for_delivery','with_courier',
    'delivered','failed_attempt','returned','return','ready_for_return'
  );

-- 4. Trigger: set shipped_at once when delivery_status transitions to 'shipped'
CREATE OR REPLACE FUNCTION public.set_shipped_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.delivery_status = 'shipped'
     AND (OLD.delivery_status IS DISTINCT FROM 'shipped')
     AND NEW.shipped_at IS NULL
  THEN
    NEW.shipped_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_shipped_at ON public.orders;
CREATE TRIGGER trg_set_shipped_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.set_shipped_at();

-- 5. Update get_follow_ups_data to use shipped_at column directly
DROP FUNCTION IF EXISTS public.get_follow_ups_data();

CREATE FUNCTION public.get_follow_ups_data()
 RETURNS TABLE(
  order_id text,
  customer_name text,
  customer_phone text,
  customer_city text,
  delivery_status text,
  shipping_status text,
  shipping_company text,
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
  total_amount numeric,
  fu_no_answer_count integer
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
    o.shipping_company,
    o.orio_order_id::bigint AS orio_order_id,
    o.orio_consignment_no,
    o.shipped_at,
    CASE
      WHEN o.shipped_at IS NOT NULL
      THEN GREATEST(0, EXTRACT(DAY FROM (now() - o.shipped_at))::integer)
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
    o.total_amount,
    COALESCE(fu.fu_no_answer_count, 0)::integer AS fu_no_answer_count
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

-- Also update get_follow_ups_count to stay in sync (drop/recreate with same logic)
DROP FUNCTION IF EXISTS public.get_follow_ups_count();

CREATE FUNCTION public.get_follow_ups_count()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.is_admin(v_uid);
  v_is_followup boolean := public.has_role(v_uid, 'follow_up'::app_role);
  v_is_agent boolean := public.has_role(v_uid, 'agent'::app_role);
  v_count bigint;
BEGIN
  IF NOT (v_is_admin OR v_is_agent OR v_is_followup) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.orders o
  WHERE o.delivery_status IN (
    'shipped','in_transit','out_for_delivery','with_courier',
    'delivered','failed_attempt','returned','return','ready_for_return'
  )
  AND (
    v_is_admin
    OR (v_is_followup AND o.follow_up_assigned_to = v_uid)
    OR (v_is_agent AND o.agent_id = v_uid)
  );

  RETURN v_count;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_follow_ups_data() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_follow_ups_count() TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';
