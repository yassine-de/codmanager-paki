-- 1) Update RPC to filter by delivery_status (shipped pipeline) instead of shipping_status='booked'
CREATE OR REPLACE FUNCTION public.get_follow_ups_data()
RETURNS TABLE(order_id text, customer_name text, customer_phone text, customer_city text, delivery_status text, shipping_status text, orio_order_id integer, orio_consignment_no text, shipped_at timestamp with time zone, days_since_shipped integer, follow_up_status text, follow_up_updated_at timestamp with time zone, follow_up_updated_by uuid, order_created_at timestamp with time zone, order_updated_at timestamp with time zone, seller_id uuid, seller_name text, agent_id uuid, agent_name text, follow_up_assigned_to uuid, follow_up_note text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
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
  WITH shipped_events AS (
    SELECT DISTINCT ON (oh.order_id)
      oh.order_id,
      oh.created_at AS shipped_at
    FROM public.order_history oh
    WHERE oh.field_changed = 'delivery_status'
      AND oh.new_value IN ('shipped','in_transit','out_for_delivery','with_courier','delivered','failed_attempt','returned','return','ready_for_return')
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
    se.shipped_at,
    CASE WHEN se.shipped_at IS NOT NULL
         THEN GREATEST(0, EXTRACT(DAY FROM (now() - se.shipped_at))::int)
         ELSE NULL END AS days_since_shipped,
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
    o.follow_up_note
  FROM public.orders o
  LEFT JOIN shipped_events se ON se.order_id = o.order_id
  LEFT JOIN public.order_follow_ups fu ON fu.order_id = o.order_id
  LEFT JOIN public.profiles sp ON sp.user_id = o.seller_id
  LEFT JOIN public.profiles ap ON ap.user_id = o.agent_id
  WHERE o.delivery_status IN ('shipped','in_transit','out_for_delivery','with_courier','delivered','failed_attempt','returned','return','ready_for_return','booked')
    AND (
      v_is_admin
      OR (v_is_followup AND o.follow_up_assigned_to = v_uid)
      OR v_is_agent
    );
END;
$function$;

-- 2) New trigger on orders: when delivery_status enters shipping pipeline, ensure a follow_up row + auto-assign
CREATE OR REPLACE FUNCTION public.ensure_follow_up_on_delivery_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pipeline text[] := ARRAY['shipped','in_transit','out_for_delivery','with_courier','delivered','failed_attempt','returned','return','ready_for_return','booked'];
BEGIN
  IF NEW.delivery_status IS NOT NULL
     AND NEW.delivery_status = ANY(v_pipeline)
     AND (TG_OP = 'INSERT' OR OLD.delivery_status IS DISTINCT FROM NEW.delivery_status) THEN
    INSERT INTO public.order_follow_ups (order_id, follow_up_status, updated_by)
    VALUES (NEW.order_id, 'pending', NEW.seller_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_ensure_follow_up_on_delivery ON public.orders;
CREATE TRIGGER trg_ensure_follow_up_on_delivery
AFTER INSERT OR UPDATE OF delivery_status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.ensure_follow_up_on_delivery_status();

-- 3) Add unique constraint so ON CONFLICT works (one follow_up row per order)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_follow_ups_order_id_unique'
  ) THEN
    -- de-dup first
    DELETE FROM public.order_follow_ups a USING public.order_follow_ups b
    WHERE a.ctid < b.ctid AND a.order_id = b.order_id;
    ALTER TABLE public.order_follow_ups ADD CONSTRAINT order_follow_ups_order_id_unique UNIQUE (order_id);
  END IF;
END$$;

-- 4) Backfill: create follow_up rows for existing shipped-pipeline orders
INSERT INTO public.order_follow_ups (order_id, follow_up_status, updated_by)
SELECT o.order_id, 'pending', o.seller_id
FROM public.orders o
WHERE o.delivery_status IN ('shipped','in_transit','out_for_delivery','with_courier','delivered','failed_attempt','returned','return','ready_for_return','booked')
ON CONFLICT (order_id) DO NOTHING;

-- 5) Backfill auto-assign to follow_up users (round-robin) for orders not yet assigned
DO $$
DECLARE
  v_users uuid[];
  v_count int;
  v_idx int := 0;
  r RECORD;
BEGIN
  SELECT array_agg(ur.user_id ORDER BY ur.user_id) INTO v_users
  FROM public.user_roles ur
  JOIN public.profiles pr ON pr.user_id = ur.user_id
  WHERE ur.role = 'follow_up'::app_role AND pr.active = true;

  v_count := COALESCE(array_length(v_users, 1), 0);
  IF v_count = 0 THEN RETURN; END IF;

  FOR r IN
    SELECT o.order_id FROM public.orders o
    WHERE o.delivery_status IN ('shipped','in_transit','out_for_delivery','with_courier','delivered','failed_attempt','returned','return','ready_for_return','booked')
      AND o.follow_up_assigned_to IS NULL
    ORDER BY o.created_at
  LOOP
    UPDATE public.orders
      SET follow_up_assigned_to = v_users[(v_idx % v_count) + 1],
          follow_up_assigned_at = now()
      WHERE order_id = r.order_id;
    v_idx := v_idx + 1;
  END LOOP;
END$$;