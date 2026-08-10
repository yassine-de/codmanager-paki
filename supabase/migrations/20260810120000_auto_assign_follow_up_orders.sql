CREATE TABLE IF NOT EXISTS public.follow_up_agent_settings (
  follow_up_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  receives_new_orders boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.follow_up_agent_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage follow up agent settings" ON public.follow_up_agent_settings;
CREATE POLICY "Admins can manage follow up agent settings"
ON public.follow_up_agent_settings
FOR ALL
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Follow up users can view own settings" ON public.follow_up_agent_settings;
CREATE POLICY "Follow up users can view own settings"
ON public.follow_up_agent_settings
FOR SELECT
USING (follow_up_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_follow_up_product_assignments_user
ON public.follow_up_product_assignments(follow_up_user_id);

CREATE INDEX IF NOT EXISTS idx_follow_up_product_assignments_product
ON public.follow_up_product_assignments(product_id);

ALTER TABLE public.follow_up_product_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage follow up product assignments" ON public.follow_up_product_assignments;
CREATE POLICY "Admins can manage follow up product assignments"
ON public.follow_up_product_assignments
FOR ALL
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Follow up users can view own product assignments" ON public.follow_up_product_assignments;
CREATE POLICY "Follow up users can view own product assignments"
ON public.follow_up_product_assignments
FOR SELECT
USING (follow_up_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_orders_follow_up_assigned_to
ON public.orders(follow_up_assigned_to);

CREATE OR REPLACE FUNCTION public.touch_follow_up_agent_settings_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_follow_up_agent_settings_updated_at ON public.follow_up_agent_settings;
CREATE TRIGGER touch_follow_up_agent_settings_updated_at
BEFORE UPDATE ON public.follow_up_agent_settings
FOR EACH ROW
EXECUTE FUNCTION public.touch_follow_up_agent_settings_updated_at();

CREATE OR REPLACE FUNCTION public.is_follow_up_delivery_status(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_status, '') IN (
    'shipped',
    'in_transit',
    'out_for_delivery',
    'with_courier',
    'delivered',
    'paid',
    'failed_attempt',
    'returned',
    'return',
    'ready_for_return',
    'return_received'
  );
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

CREATE OR REPLACE FUNCTION public.assign_follow_up_agent_on_delivery_pool()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.follow_up_assigned_to IS NULL
     AND public.is_follow_up_delivery_status(NEW.delivery_status)
     AND (
       TG_OP = 'INSERT'
       OR OLD.delivery_status IS DISTINCT FROM NEW.delivery_status
       OR OLD.follow_up_assigned_to IS DISTINCT FROM NEW.follow_up_assigned_to
     )
  THEN
    PERFORM public.assign_follow_up_agent_for_order(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_auto_assign_follow_up_agent ON public.orders;
CREATE TRIGGER orders_auto_assign_follow_up_agent
AFTER INSERT OR UPDATE OF delivery_status, follow_up_assigned_to ON public.orders
FOR EACH ROW
WHEN (
  NEW.follow_up_assigned_to IS NULL
  AND public.is_follow_up_delivery_status(NEW.delivery_status)
)
EXECUTE FUNCTION public.assign_follow_up_agent_on_delivery_pool();

INSERT INTO public.follow_up_agent_settings (follow_up_user_id, receives_new_orders)
SELECT ur.user_id, true
FROM public.user_roles ur
WHERE ur.role = 'follow_up'
ON CONFLICT (follow_up_user_id) DO NOTHING;
