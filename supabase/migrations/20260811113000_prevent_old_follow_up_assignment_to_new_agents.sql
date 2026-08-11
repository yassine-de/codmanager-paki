ALTER TABLE public.follow_up_agent_settings
ADD COLUMN IF NOT EXISTS assignment_started_at timestamptz;

UPDATE public.follow_up_agent_settings s
SET assignment_started_at = COALESCE(p.created_at, s.created_at, now())
FROM public.profiles p
WHERE p.user_id = s.follow_up_user_id
  AND s.assignment_started_at IS NULL;

UPDATE public.follow_up_agent_settings
SET assignment_started_at = COALESCE(created_at, now())
WHERE assignment_started_at IS NULL;

ALTER TABLE public.follow_up_agent_settings
ALTER COLUMN assignment_started_at SET DEFAULT now();

ALTER TABLE public.follow_up_agent_settings
ALTER COLUMN assignment_started_at SET NOT NULL;

CREATE OR REPLACE FUNCTION public.touch_follow_up_agent_settings_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.receives_new_orders IS TRUE
     AND COALESCE(OLD.receives_new_orders, false) IS FALSE
  THEN
    NEW.assignment_started_at := now();
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

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
      count(o.id) FILTER (
        WHERE public.is_follow_up_delivery_status(o.delivery_status)
      ) AS active_load,
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
    ORDER BY active_load ASC, last_assigned_at ASC NULLS FIRST, ur.user_id ASC
    LIMIT 1
  )
  SELECT user_id INTO v_assignee
  FROM product_candidates;

  IF v_assignee IS NULL THEN
    WITH general_candidates AS (
      SELECT
        ur.user_id,
        count(o.id) FILTER (
          WHERE public.is_follow_up_delivery_status(o.delivery_status)
        ) AS active_load,
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
      ORDER BY active_load ASC, last_assigned_at ASC NULLS FIRST, ur.user_id ASC
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
