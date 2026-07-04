-- Full legacy app compatibility.
-- Goal: preserve existing application behavior while keeping the new carrier/shipment
-- model available for the shipping-company redesign.

DROP VIEW IF EXISTS public.order_list_view CASCADE;

-- ---------------------------------------------------------------------------
-- Relax status columns back to text for legacy UI/status values.
-- ---------------------------------------------------------------------------

ALTER TABLE public.orders
  ALTER COLUMN confirmation_status TYPE text USING confirmation_status::text,
  ALTER COLUMN delivery_status TYPE text USING delivery_status::text,
  ALTER COLUMN fulfillment_status TYPE text USING fulfillment_status::text,
  ALTER COLUMN payment_status TYPE text USING payment_status::text;

-- ---------------------------------------------------------------------------
-- Legacy order/product fields expected by current React pages and Edge Functions.
-- ---------------------------------------------------------------------------

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_id text,
  ADD COLUMN IF NOT EXISTS system_id bigint,
  ADD COLUMN IF NOT EXISTS product_name text,
  ADD COLUMN IF NOT EXISTS product_url text,
  ADD COLUMN IF NOT EXISTS video_url text,
  ADD COLUMN IF NOT EXISTS store_url text,
  ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS price numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weight numeric,
  ADD COLUMN IF NOT EXISTS fragile boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS shipping_cost numeric,
  ADD COLUMN IF NOT EXISTS shipping_status text,
  ADD COLUMN IF NOT EXISTS shipping_company text,
  ADD COLUMN IF NOT EXISTS invoice_id uuid,
  ADD COLUMN IF NOT EXISTS source_sheet_id uuid,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attempts_today integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_attempt_date date,
  ADD COLUMN IF NOT EXISTS postpone_date timestamptz,
  ADD COLUMN IF NOT EXISTS postpone_note text,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS follow_up_assigned_to uuid,
  ADD COLUMN IF NOT EXISTS follow_up_assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS follow_up_note text,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS agent_switch_scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS agent_switched_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_manual_price boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_price numeric,
  ADD COLUMN IF NOT EXISTS offers text,
  ADD COLUMN IF NOT EXISTS shipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS orio_order_id bigint,
  ADD COLUMN IF NOT EXISTS orio_consignment_no text,
  ADD COLUMN IF NOT EXISTS orio_shipping_status text,
  ADD COLUMN IF NOT EXISTS orio_sync_status text,
  ADD COLUMN IF NOT EXISTS orio_sync_error text,
  ADD COLUMN IF NOT EXISTS orio_synced_at timestamptz;

UPDATE public.orders
SET order_id = COALESCE(order_id, order_number),
    system_id = COALESCE(system_id, system_number),
    product_name = COALESCE(product_name, metadata->>'product_name', 'Product'),
    price = COALESCE(NULLIF(price, 0), total_amount),
    quantity = COALESCE(NULLIF(quantity, 0), 1)
WHERE order_id IS NULL OR system_id IS NULL OR product_name IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_order_id_legacy_unique'
  ) THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_order_id_legacy_unique UNIQUE (order_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_legacy_order_id ON public.orders(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_system_id ON public.orders(system_id);
CREATE INDEX IF NOT EXISTS idx_orders_orio_order_id ON public.orders(orio_order_id) WHERE orio_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_orio_sync_status ON public.orders(orio_sync_status);
CREATE INDEX IF NOT EXISTS idx_orders_follow_up_assigned ON public.orders(follow_up_assigned_to);
CREATE INDEX IF NOT EXISTS idx_orders_source_sheet ON public.orders(source_sheet_id);

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS display_id text,
  ADD COLUMN IF NOT EXISTS price numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_price numeric,
  ADD COLUMN IF NOT EXISTS landed_price numeric,
  ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weight text,
  ADD COLUMN IF NOT EXISTS weight_kg numeric,
  ADD COLUMN IF NOT EXISTS variants jsonb,
  ADD COLUMN IF NOT EXISTS offers jsonb,
  ADD COLUMN IF NOT EXISTS seller_seen boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS scraped_image_url text,
  ADD COLUMN IF NOT EXISTS ai_context text,
  ADD COLUMN IF NOT EXISTS ai_context_scraped_at timestamptz,
  ADD COLUMN IF NOT EXISTS sourcing_request_id uuid;

-- ---------------------------------------------------------------------------
-- Legacy operational tables.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.integration_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL,
  name text NOT NULL,
  sheet_name text NOT NULL DEFAULT '',
  sheet_url text NOT NULL DEFAULT '',
  orders_count integer NOT NULL DEFAULT 0,
  errors_count integer NOT NULL DEFAULT 0,
  last_check timestamptz,
  active boolean NOT NULL DEFAULT true,
  last_imported_row integer NOT NULL DEFAULT 1,
  column_mapping jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.integration_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id uuid NOT NULL REFERENCES public.integration_sheets(id) ON DELETE CASCADE,
  order_data jsonb,
  error_message text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL,
  changed_by uuid,
  changed_by_role text NOT NULL DEFAULT 'system',
  field_changed text NOT NULL,
  old_value text,
  new_value text,
  action_type text NOT NULL DEFAULT 'status_change',
  attempt_number integer,
  group_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL UNIQUE,
  follow_up_status text NOT NULL DEFAULT 'pending',
  fu_no_answer_count integer NOT NULL DEFAULT 0,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL,
  agent_id uuid NOT NULL,
  call_start_time timestamptz NOT NULL DEFAULT now(),
  call_end_time timestamptz,
  duration integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL,
  agent_name text,
  activity_type text NOT NULL,
  order_id text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL,
  product_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, product_name)
);

CREATE TABLE IF NOT EXISTS public.follow_up_seller_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follow_up_user_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (follow_up_user_id, seller_id)
);

CREATE TABLE IF NOT EXISTS public.follow_up_product_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follow_up_user_id uuid NOT NULL,
  product_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (follow_up_user_id, product_id)
);

CREATE TABLE IF NOT EXISTS public.alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  message text NOT NULL,
  urgency text NOT NULL DEFAULT 'medium',
  is_active boolean NOT NULL DEFAULT true,
  start_date timestamptz,
  end_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_presence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  last_seen timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.seller_order_prefixes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL UNIQUE,
  prefix text NOT NULL UNIQUE,
  current_counter integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.seller_invoice_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL UNIQUE,
  current_counter integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.seller_product_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL UNIQUE,
  current_counter integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.seller_sourcing_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL UNIQUE,
  current_counter integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.seller_display_id_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prefix text NOT NULL UNIQUE,
  current_counter integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.seller_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  rate_1kg numeric NOT NULL DEFAULT 35,
  rate_2kg numeric NOT NULL DEFAULT 45,
  rate_3kg numeric NOT NULL DEFAULT 55,
  rate_3kg_plus numeric NOT NULL DEFAULT 70
);

CREATE TABLE IF NOT EXISTS public.rate_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid,
  is_global boolean NOT NULL DEFAULT false,
  is_custom boolean NOT NULL DEFAULT false,
  shipping_rate_1kg numeric NOT NULL DEFAULT 0,
  shipping_rate_2kg numeric NOT NULL DEFAULT 0,
  shipping_rate_3kg numeric NOT NULL DEFAULT 0,
  dropped_order_rate numeric NOT NULL DEFAULT 0,
  confirmed_order_rate numeric NOT NULL DEFAULT 0,
  cod_fee_per_delivery numeric NOT NULL DEFAULT 0,
  agent_commission_confirmed numeric NOT NULL DEFAULT 0,
  agent_commission_delivered numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.seller_payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  method text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  cih_account_name text,
  cih_rib text,
  binance_id text,
  binance_wallet_address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sourcing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL,
  display_id text,
  product_name text NOT NULL,
  product_url text NOT NULL DEFAULT '',
  product_image_url text,
  source_product_id uuid,
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric,
  total_price numeric,
  seller_price numeric,
  landed_price numeric,
  product_weight text,
  shipping_method text NOT NULL DEFAULT 'air',
  shipping_cost numeric,
  destination_country text NOT NULL DEFAULT 'Pakistan',
  payment_method text,
  payment_status text NOT NULL DEFAULT 'pending',
  payment_date date,
  tracking_id text,
  freight_forwarder text,
  status text NOT NULL DEFAULT 'pending',
  notes text,
  variants jsonb,
  seller_seen boolean DEFAULT false,
  admin_seen boolean DEFAULT false,
  seller_validated boolean DEFAULT false,
  product_created boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sourcing_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sourcing_request_id uuid NOT NULL,
  changed_by uuid NOT NULL,
  field_changed text NOT NULL,
  old_value text,
  new_value text,
  action_type text NOT NULL DEFAULT 'update',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL,
  issue_type text NOT NULL DEFAULT 'general',
  related_id text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  sender_type text NOT NULL DEFAULT 'seller',
  message text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invoice_addons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  product_id uuid,
  type text NOT NULL DEFAULT 'addon',
  reason text NOT NULL DEFAULT '',
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invoice_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  order_id text,
  event_type text NOT NULL DEFAULT 'update',
  field_changed text,
  old_value text,
  new_value text,
  description text,
  metadata jsonb,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Existing new invoice tables need legacy columns too.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS paid_by uuid,
  ADD COLUMN IF NOT EXISTS payment_proof_url text,
  ADD COLUMN IF NOT EXISTS previous_balance numeric NOT NULL DEFAULT 0;

ALTER TABLE public.invoice_adjustments
  ADD COLUMN IF NOT EXISTS applied_invoice_id uuid,
  ADD COLUMN IF NOT EXISTS difference numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_shipping_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_status text,
  ADD COLUMN IF NOT EXISTS old_status text,
  ADD COLUMN IF NOT EXISTS previous_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS previous_shipping_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS shipping_difference numeric NOT NULL DEFAULT 0;

-- ORIO compatibility tables. New code should use carrier_city_cache; old UI/Edge
-- Functions can keep reading/writing these until shipping is refactored.
CREATE TABLE IF NOT EXISTS public.orio_cities_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id integer NOT NULL,
  city_name text NOT NULL,
  province_id integer,
  cached_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.orio_platform_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id integer NOT NULL,
  platform_name text NOT NULL,
  cached_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orio_cities_name ON public.orio_cities_cache(city_name);
CREATE INDEX IF NOT EXISTS idx_integration_sheets_seller ON public.integration_sheets(seller_id);
CREATE INDEX IF NOT EXISTS idx_order_history_order_created ON public.order_history(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_follow_ups_status ON public.order_follow_ups(follow_up_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_agent_created ON public.calls(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sourcing_requests_seller_created ON public.sourcing_requests(seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_seller_status ON public.support_tickets(seller_id, status);

-- ---------------------------------------------------------------------------
-- Legacy RPCs used by current app.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.generate_order_id(p_seller_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text;
  v_counter integer;
BEGIN
  SELECT prefix, current_counter + 1
    INTO v_prefix, v_counter
  FROM public.seller_order_prefixes
  WHERE seller_id = p_seller_id
  FOR UPDATE;

  IF v_prefix IS NULL THEN
    v_prefix := 'OR';
    INSERT INTO public.seller_order_prefixes (seller_id, prefix, current_counter)
    VALUES (p_seller_id, v_prefix, 1)
    ON CONFLICT (seller_id) DO UPDATE SET current_counter = public.seller_order_prefixes.current_counter + 1
    RETURNING current_counter INTO v_counter;
  ELSE
    UPDATE public.seller_order_prefixes
    SET current_counter = v_counter
    WHERE seller_id = p_seller_id;
  END IF;

  RETURN v_prefix || '-' || v_counter::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_product_display_id(p_seller_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counter integer;
BEGIN
  INSERT INTO public.seller_product_counters (seller_id, current_counter)
  VALUES (p_seller_id, 1)
  ON CONFLICT (seller_id) DO UPDATE SET current_counter = public.seller_product_counters.current_counter + 1
  RETURNING current_counter INTO v_counter;
  RETURN 'P-' || v_counter::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_sourcing_display_id(p_seller_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counter integer;
BEGIN
  INSERT INTO public.seller_sourcing_counters (seller_id, current_counter)
  VALUES (p_seller_id, 1)
  ON CONFLICT (seller_id) DO UPDATE SET current_counter = public.seller_sourcing_counters.current_counter + 1
  RETURNING current_counter INTO v_counter;
  RETURN 'SR-' || v_counter::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = _user_id LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_agent_rankings()
RETURNS TABLE(agent_id uuid, agent_name text, confirmed_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.agent_id, p.name, count(*)::bigint
  FROM public.orders o
  LEFT JOIN public.profiles p ON p.user_id = o.agent_id
  WHERE o.agent_id IS NOT NULL AND o.confirmation_status = 'confirmed'
  GROUP BY o.agent_id, p.name
  ORDER BY count(*) DESC;
$$;

CREATE OR REPLACE FUNCTION public.claim_next_order(
  p_agent_id uuid,
  p_order_type text DEFAULT 'new',
  p_product_names text[] DEFAULT NULL
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  SELECT *
  INTO v_order
  FROM public.orders
  WHERE confirmation_status = p_order_type
    AND agent_id IS NULL
    AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
  ORDER BY created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.orders
  SET agent_id = p_agent_id, assigned_at = now(), updated_at = now()
  WHERE id = v_order.id
  RETURNING * INTO v_order;

  RETURN v_order;
END;
$$;

CREATE OR REPLACE FUNCTION public.reclaim_no_answer_order(p_order_id uuid)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  UPDATE public.orders
  SET confirmation_status = 'new', agent_id = NULL, updated_at = now()
  WHERE id = p_order_id
  RETURNING * INTO v_order;
  RETURN v_order;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_has_treated_order(_order_id text, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.order_history
    WHERE order_id = _order_id AND changed_by = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.release_order_lock(p_order_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.orders SET agent_id = NULL, assigned_at = NULL, updated_at = now()
  WHERE id = p_order_id;
$$;

CREATE OR REPLACE FUNCTION public.touch_order_lock(p_order_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.orders SET assigned_at = now(), updated_at = now()
  WHERE id = p_order_id;
$$;

CREATE OR REPLACE FUNCTION public.resolve_duplicate_group(p_group_id text, p_keep_order_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object('success', true, 'group_id', p_group_id, 'keep_order_id', p_keep_order_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_invoice_adjustment(p_adjustment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.invoice_adjustments
  SET status = 'approved', reviewed_at = now(), reviewed_by = auth.uid(), updated_at = now()
  WHERE id = p_adjustment_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_invoice_adjustment(p_adjustment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.invoice_adjustments
  SET status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid(), updated_at = now()
  WHERE id = p_adjustment_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_follow_ups_data()
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
  shipped_at timestamptz,
  days_since_shipped integer,
  follow_up_status text,
  follow_up_updated_at timestamptz,
  follow_up_updated_by uuid,
  order_created_at timestamptz,
  order_updated_at timestamptz,
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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.order_id,
    o.customer_name,
    o.customer_phone,
    o.customer_city,
    o.delivery_status,
    COALESCE(o.orio_shipping_status, o.shipping_status) AS shipping_status,
    o.shipping_company,
    o.orio_order_id,
    o.orio_consignment_no,
    COALESCE(o.shipped_at, o.orio_synced_at) AS shipped_at,
    CASE WHEN COALESCE(o.shipped_at, o.orio_synced_at) IS NOT NULL
      THEN GREATEST(0, EXTRACT(DAY FROM (now() - COALESCE(o.shipped_at, o.orio_synced_at)))::integer)
      ELSE NULL
    END AS days_since_shipped,
    COALESCE(fu.follow_up_status, 'pending'),
    fu.updated_at,
    fu.updated_by,
    o.created_at,
    o.updated_at,
    o.seller_id,
    sp.name,
    o.agent_id,
    ap.name,
    o.follow_up_assigned_to,
    o.follow_up_note,
    o.product_name,
    o.total_amount,
    COALESCE(fu.fu_no_answer_count, 0)::integer
  FROM public.orders o
  LEFT JOIN public.order_follow_ups fu ON fu.order_id = o.order_id
  LEFT JOIN public.profiles sp ON sp.user_id = o.seller_id
  LEFT JOIN public.profiles ap ON ap.user_id = o.agent_id
  WHERE o.delivery_status IN ('booked','shipped','in_transit','out_for_delivery','with_courier','delivered','failed_attempt','returned','return','ready_for_return')
  ORDER BY o.updated_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_follow_ups_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer
  FROM public.orders
  WHERE delivery_status IN ('booked','shipped','in_transit','out_for_delivery','with_courier','delivered','failed_attempt','returned','return','ready_for_return');
$$;

CREATE OR REPLACE VIEW public.order_list_view AS
SELECT
  o.id,
  o.order_number,
  o.system_number,
  o.seller_id,
  sp.name AS seller_name,
  o.customer_name,
  o.customer_phone,
  o.customer_phone_normalized,
  o.customer_city,
  o.confirmation_status,
  o.delivery_status,
  o.fulfillment_status,
  o.payment_status,
  o.total_amount,
  o.agent_id,
  ap.name AS agent_name,
  o.created_at,
  o.updated_at,
  o.confirmed_at,
  o.delivered_at,
  COALESCE(items.item_count, 0) AS item_count,
  COALESCE(items.first_product_name, o.product_name) AS first_product_name,
  s.id AS current_shipment_id,
  COALESCE(s.tracking_number, o.orio_consignment_no) AS tracking_number,
  c.code AS carrier_code,
  COALESCE(c.name, o.shipping_company) AS carrier_name,
  s.sync_status AS shipment_sync_status
FROM public.orders o
LEFT JOIN public.profiles sp ON sp.user_id = o.seller_id
LEFT JOIN public.profiles ap ON ap.user_id = o.agent_id
LEFT JOIN LATERAL (
  SELECT COUNT(*)::integer AS item_count, MIN(product_name) AS first_product_name
  FROM public.order_items oi
  WHERE oi.order_id = o.id
) items ON true
LEFT JOIN LATERAL (
  SELECT sh.*
  FROM public.shipments sh
  WHERE sh.order_id = o.id
  ORDER BY sh.created_at DESC, sh.id DESC
  LIMIT 1
) s ON true
LEFT JOIN public.carriers c ON c.id = s.carrier_id;

CREATE OR REPLACE FUNCTION public.get_orders_page(
  p_limit integer DEFAULT 50,
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_seller_id uuid DEFAULT NULL,
  p_confirmation_status text DEFAULT NULL,
  p_delivery_status text DEFAULT NULL,
  p_fulfillment_status text DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS SETOF public.order_list_view
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.order_list_view v
  WHERE (p_seller_id IS NULL OR v.seller_id = p_seller_id)
    AND (p_confirmation_status IS NULL OR v.confirmation_status = p_confirmation_status)
    AND (p_delivery_status IS NULL OR v.delivery_status = p_delivery_status)
    AND (p_fulfillment_status IS NULL OR v.fulfillment_status = p_fulfillment_status)
    AND (
      p_search IS NULL OR p_search = ''
      OR v.order_number ILIKE '%' || p_search || '%'
      OR v.customer_phone_normalized ILIKE '%' || public.normalize_phone_key(p_search) || '%'
      OR v.customer_name ILIKE '%' || p_search || '%'
      OR v.tracking_number ILIKE '%' || p_search || '%'
    )
    AND (
      p_cursor_created_at IS NULL
      OR (v.created_at, v.id) < (p_cursor_created_at, p_cursor_id)
    )
  ORDER BY v.created_at DESC, v.id DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 200);
$$;

CREATE OR REPLACE FUNCTION public.add_invoice_addon(
  p_invoice_id uuid,
  p_type text,
  p_reason text,
  p_amount numeric,
  p_product_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.invoice_addons(invoice_id, type, reason, amount, product_id)
  VALUES (p_invoice_id, p_type, p_reason, p_amount, p_product_id)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_invoice_addon(p_addon_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.invoice_addons WHERE id = p_addon_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- RLS for restored tables.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'integration_sheets','integration_errors','order_history','order_follow_ups',
    'calls','agent_activity_log','agent_products','follow_up_seller_assignments',
    'follow_up_product_assignments','alerts','user_presence','seller_order_prefixes',
    'seller_invoice_counters','seller_product_counters','seller_sourcing_counters',
    'seller_display_id_counters','seller_rates','rate_settings','seller_payment_methods',
    'sourcing_requests','sourcing_history','support_tickets','support_messages',
    'invoice_addons','invoice_history','orio_cities_cache','orio_platform_cache'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Staff manage ' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()))',
      'Staff manage ' || t,
      t
    );
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.generate_order_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_product_display_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_sourcing_display_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_agent_rankings() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_next_order(uuid, text, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reclaim_no_answer_order(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent_has_treated_order(text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_order_lock(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.touch_order_lock(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_duplicate_group(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_invoice_adjustment(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reject_invoice_adjustment(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_follow_ups_data() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_follow_ups_count() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_invoice_addon(uuid, text, text, numeric, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_invoice_addon(uuid) TO authenticated, service_role;
GRANT SELECT ON public.order_list_view TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_orders_page(integer, timestamptz, uuid, uuid, text, text, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
