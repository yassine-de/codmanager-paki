-- 1. Columns on orders
ALTER TABLE public.orders 
  ADD COLUMN IF NOT EXISTS follow_up_note text DEFAULT '',
  ADD COLUMN IF NOT EXISTS follow_up_assigned_to uuid,
  ADD COLUMN IF NOT EXISTS follow_up_assigned_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_orders_follow_up_assigned_to ON public.orders(follow_up_assigned_to);

-- 2. Scope tables
CREATE TABLE IF NOT EXISTS public.follow_up_seller_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follow_up_user_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(follow_up_user_id, seller_id)
);
ALTER TABLE public.follow_up_seller_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage fu seller assignments" ON public.follow_up_seller_assignments
  FOR ALL TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));
CREATE POLICY "FU users view own seller assignments" ON public.follow_up_seller_assignments
  FOR SELECT TO authenticated USING (auth.uid() = follow_up_user_id);

CREATE TABLE IF NOT EXISTS public.follow_up_product_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follow_up_user_id uuid NOT NULL,
  product_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(follow_up_user_id, product_id)
);
ALTER TABLE public.follow_up_product_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage fu product assignments" ON public.follow_up_product_assignments
  FOR ALL TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));
CREATE POLICY "FU users view own product assignments" ON public.follow_up_product_assignments
  FOR SELECT TO authenticated USING (auth.uid() = follow_up_user_id);

-- 3. App settings defaults
INSERT INTO public.app_settings (key, value)
VALUES ('follow_up_assignment_mode', 'round_robin')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_settings (key, value)
VALUES ('follow_up_round_robin_index', '0')
ON CONFLICT (key) DO NOTHING;

-- 4. Auto-assignment trigger function on order_follow_ups
CREATE OR REPLACE FUNCTION public.auto_assign_follow_up_on_followup_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode text;
  v_seller_id uuid;
  v_assigned uuid;
  v_index int;
  v_user_ids uuid[];
  v_count int;
  v_already uuid;
BEGIN
  IF NEW.follow_up_status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT follow_up_assigned_to INTO v_already FROM public.orders WHERE order_id = NEW.order_id;
  IF v_already IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT value INTO v_mode FROM public.app_settings WHERE key = 'follow_up_assignment_mode';
  IF v_mode IS NULL THEN v_mode := 'round_robin'; END IF;

  IF v_mode = 'manual' THEN RETURN NEW; END IF;

  SELECT seller_id INTO v_seller_id FROM public.orders WHERE order_id = NEW.order_id;

  IF v_mode = 'by_seller' THEN
    SELECT follow_up_user_id INTO v_assigned
    FROM public.follow_up_seller_assignments
    WHERE seller_id = v_seller_id
    ORDER BY created_at LIMIT 1;
  ELSIF v_mode = 'by_product' THEN
    SELECT fpa.follow_up_user_id INTO v_assigned
    FROM public.follow_up_product_assignments fpa
    JOIN public.products p ON p.id = fpa.product_id
    WHERE p.seller_id = v_seller_id
    ORDER BY fpa.created_at LIMIT 1;
  END IF;

  IF v_assigned IS NULL THEN
    SELECT array_agg(ur.user_id ORDER BY ur.user_id) INTO v_user_ids
    FROM public.user_roles ur
    JOIN public.profiles pr ON pr.user_id = ur.user_id
    WHERE ur.role = 'follow_up'::app_role AND pr.active = true;

    v_count := COALESCE(array_length(v_user_ids, 1), 0);
    IF v_count > 0 THEN
      SELECT COALESCE(NULLIF(value, '')::int, 0) INTO v_index FROM public.app_settings WHERE key = 'follow_up_round_robin_index';
      v_index := v_index % v_count;
      v_assigned := v_user_ids[v_index + 1];
      UPDATE public.app_settings SET value = ((v_index + 1) % v_count)::text, updated_at = now()
        WHERE key = 'follow_up_round_robin_index';
    END IF;
  END IF;

  IF v_assigned IS NOT NULL THEN
    UPDATE public.orders
      SET follow_up_assigned_to = v_assigned,
          follow_up_assigned_at = now()
      WHERE order_id = NEW.order_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_assign_follow_up ON public.order_follow_ups;
CREATE TRIGGER trg_auto_assign_follow_up
AFTER INSERT OR UPDATE OF follow_up_status ON public.order_follow_ups
FOR EACH ROW
EXECUTE FUNCTION public.auto_assign_follow_up_on_followup_row();

-- 5. RLS for follow_up users on orders
CREATE POLICY "Follow up users view assigned orders" ON public.orders
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'follow_up'::app_role) 
    AND follow_up_assigned_to = auth.uid()
  );

CREATE POLICY "Follow up users update assigned orders" ON public.orders
  FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'follow_up'::app_role) 
    AND follow_up_assigned_to = auth.uid()
  )
  WITH CHECK (
    has_role(auth.uid(), 'follow_up'::app_role) 
    AND follow_up_assigned_to = auth.uid()
  );

-- 6. RLS for follow_up users on order_follow_ups
CREATE POLICY "Follow up users view own follow_ups" ON public.order_follow_ups
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'follow_up'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.orders o 
      WHERE o.order_id = order_follow_ups.order_id 
      AND o.follow_up_assigned_to = auth.uid()
    )
  );

CREATE POLICY "Follow up users insert follow_ups" ON public.order_follow_ups
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'follow_up'::app_role)
    AND auth.uid() = updated_by
    AND EXISTS (
      SELECT 1 FROM public.orders o 
      WHERE o.order_id = order_follow_ups.order_id 
      AND o.follow_up_assigned_to = auth.uid()
    )
  );

CREATE POLICY "Follow up users update follow_ups" ON public.order_follow_ups
  FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'follow_up'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.orders o 
      WHERE o.order_id = order_follow_ups.order_id 
      AND o.follow_up_assigned_to = auth.uid()
    )
  )
  WITH CHECK (
    has_role(auth.uid(), 'follow_up'::app_role)
    AND auth.uid() = updated_by
  );

-- 7. Read-only product / profile / user_roles access for follow_up users (for displaying)
CREATE POLICY "Follow up users view products" ON public.products
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'follow_up'::app_role));

CREATE POLICY "Follow up users view profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'follow_up'::app_role));