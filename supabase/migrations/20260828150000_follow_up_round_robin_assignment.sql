-- The auto-assign function previously picked the follow-up agent with the
-- lowest lifetime "active_load" (count of orders ever assigned to them still
-- sitting in a post-shipped delivery_status — which almost never decreases,
-- since delivered/returned/etc are themselves counted as "active"). Once one
-- agent built up a lead, the load-based ordering kept routing every new
-- order to the other agent until the historical gap closed — which, with a
-- large enough gap, meant one agent got 100% of new dispatches for an
-- extended stretch while the other got none (confirmed live: all 491 orders
-- assigned in the last 7 days went to a single agent).
--
-- Switch to a pure round-robin: always give the next order to whichever
-- eligible agent was assigned an order longest ago (ties broken by user_id).
-- With exactly 2 agents this alternates every single order, independent of
-- historical totals — a clean 50/50 split starting from the next dispatch.
CREATE OR REPLACE FUNCTION public.assign_follow_up_agent_for_order(p_order_uuid uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_assignee uuid;
  v_follow_up_started_at timestamptz;
BEGIN
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_uuid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_order.follow_up_assigned_to IS NOT NULL THEN
    RETURN v_order.follow_up_assigned_to;
  END IF;

  IF NOT public.is_follow_up_delivery_status(v_order.delivery_status) THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(
    v_order.shipped_at,
    (
      SELECT sh.booked_at
      FROM public.shipments sh
      WHERE sh.order_uuid = v_order.id
      ORDER BY sh.created_at ASC, sh.id ASC
      LIMIT 1
    ),
    v_order.updated_at,
    v_order.created_at
  )
  INTO v_follow_up_started_at;

  WITH order_products AS (
    SELECT DISTINCT oi.product_id
    FROM public.order_items oi
    WHERE oi.order_id = v_order.id
      AND oi.product_id IS NOT NULL
  ),
  product_candidates AS (
    SELECT
      ur.user_id,
      max(o.follow_up_assigned_at) AS last_assigned_at
    FROM public.user_roles ur
    JOIN public.profiles p ON p.user_id = ur.user_id
    LEFT JOIN public.follow_up_agent_settings s ON s.follow_up_user_id = ur.user_id
    JOIN public.follow_up_product_assignments fpa ON fpa.follow_up_user_id = ur.user_id
    JOIN order_products op ON op.product_id = fpa.product_id
    LEFT JOIN public.orders o ON o.follow_up_assigned_to = ur.user_id
    WHERE ur.role = 'follow_up'
      AND COALESCE(p.active, true)
      AND COALESCE(s.receives_new_orders, true)
      AND COALESCE(s.assignment_started_at, p.created_at, '-infinity'::timestamptz) <= v_follow_up_started_at
    GROUP BY ur.user_id
    ORDER BY last_assigned_at ASC NULLS FIRST, ur.user_id ASC
    LIMIT 1
  )
  SELECT user_id INTO v_assignee
  FROM product_candidates;

  IF v_assignee IS NULL THEN
    WITH general_candidates AS (
      SELECT
        ur.user_id,
        max(o.follow_up_assigned_at) AS last_assigned_at
      FROM public.user_roles ur
      JOIN public.profiles p ON p.user_id = ur.user_id
      LEFT JOIN public.follow_up_agent_settings s ON s.follow_up_user_id = ur.user_id
      LEFT JOIN public.follow_up_product_assignments fpa ON fpa.follow_up_user_id = ur.user_id
      LEFT JOIN public.orders o ON o.follow_up_assigned_to = ur.user_id
      WHERE ur.role = 'follow_up'
        AND COALESCE(p.active, true)
        AND COALESCE(s.receives_new_orders, true)
        AND COALESCE(s.assignment_started_at, p.created_at, '-infinity'::timestamptz) <= v_follow_up_started_at
        AND fpa.id IS NULL
      GROUP BY ur.user_id
      ORDER BY last_assigned_at ASC NULLS FIRST, ur.user_id ASC
      LIMIT 1
    )
    SELECT user_id INTO v_assignee
    FROM general_candidates;
  END IF;

  IF v_assignee IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.orders
  SET follow_up_assigned_to = v_assignee,
      follow_up_assigned_at = now()
  WHERE id = v_order.id
    AND follow_up_assigned_to IS NULL;

  RETURN v_assignee;
END;
$$;

NOTIFY pgrst, 'reload schema';
