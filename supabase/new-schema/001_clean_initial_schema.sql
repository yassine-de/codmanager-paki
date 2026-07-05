-- Clean initial schema for the new application database.
-- Principle:
--   - Preserve the existing app domains: users, orders, products, WhatsApp,
--     sheets, sourcing, support, invoices, follow-ups, analytics helpers.
--   - Redesign only shipping: carriers + shipments + fulfillment + inventory.
--   - Do not create orio_* tables or columns. ORIO is represented only as a
--     carrier row with code = 'orio'.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ---------------------------------------------------------------------------
-- Enums and helpers
-- ---------------------------------------------------------------------------

CREATE TYPE public.app_role AS ENUM (
  'admin',
  'seller',
  'agent',
  'follow_up',
  'warehouse_agent',
  'warehouse_manager',
  'custom'
);

CREATE TYPE public.carrier_fulfillment_mode AS ENUM (
  'carrier_managed',
  'self_fulfilled',
  'hybrid'
);

CREATE TYPE public.shipment_sync_status AS ENUM (
  'pending',
  'synced',
  'failed',
  'cancelled'
);

CREATE TYPE public.fulfillment_batch_status AS ENUM (
  'open',
  'packing',
  'ready_for_pickup',
  'picked_up',
  'closed',
  'cancelled'
);

CREATE TYPE public.fulfillment_item_status AS ENUM (
  'pending',
  'picked',
  'packed',
  'label_printed',
  'scanned',
  'ready',
  'picked_up',
  'returned',
  'cancelled'
);

CREATE TYPE public.inventory_location_type AS ENUM (
  'sellable',
  'reserved',
  'returns',
  'damaged',
  'lost'
);

CREATE TYPE public.inventory_movement_type AS ENUM (
  'initial',
  'ship',
  'return_received',
  'restock',
  'damage',
  'adjustment',
  'correction'
);

CREATE TYPE public.scan_type AS ENUM (
  'outbound',
  'return',
  'pickup',
  'audit'
);

CREATE TYPE public.scan_result AS ENUM (
  'ok',
  'duplicate',
  'unknown',
  'wrong_status',
  'wrong_batch',
  'error'
);

CREATE TYPE public.return_condition AS ENUM (
  'sellable',
  'damaged',
  'needs_inspection',
  'missing_item',
  'wrong_item'
);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_phone_key(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p IS NULL THEN NULL
    ELSE regexp_replace(
      CASE
        WHEN regexp_replace(p, '\D', '', 'g') LIKE '0092%' THEN substr(regexp_replace(p, '\D', '', 'g'), 3)
        WHEN regexp_replace(p, '\D', '', 'g') LIKE '92%' THEN regexp_replace(p, '\D', '', 'g')
        WHEN regexp_replace(p, '\D', '', 'g') LIKE '0%' THEN '92' || substr(regexp_replace(p, '\D', '', 'g'), 2)
        ELSE regexp_replace(p, '\D', '', 'g')
      END,
      '\D', '', 'g'
    )
  END;
$$;

-- ---------------------------------------------------------------------------
-- Users, roles, permissions
-- ---------------------------------------------------------------------------

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_id text UNIQUE,
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin');
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin','agent','follow_up','warehouse_agent','warehouse_manager')
  );
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

CREATE TABLE public.permissions (
  key text PRIMARY KEY,
  label text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES public.permissions(key) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, permission_key)
);

CREATE OR REPLACE FUNCTION public.get_user_permissions(_user_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(permission_key ORDER BY permission_key), ARRAY[]::text[])
  FROM public.user_permissions
  WHERE user_id = _user_id;
$$;

CREATE TABLE public.user_presence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  last_seen timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

CREATE TABLE public.app_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  key text PRIMARY KEY,
  value text,
  is_public boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  message text NOT NULL,
  urgency text NOT NULL DEFAULT 'medium',
  is_active boolean NOT NULL DEFAULT true,
  start_date timestamptz,
  end_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Products and sourcing
-- ---------------------------------------------------------------------------

CREATE TABLE public.seller_display_id_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prefix text NOT NULL UNIQUE,
  current_counter integer NOT NULL DEFAULT 0
);

CREATE TABLE public.seller_product_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  current_counter integer NOT NULL DEFAULT 0
);

CREATE TABLE public.seller_sourcing_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  current_counter integer NOT NULL DEFAULT 0
);

CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES auth.users(id),
  sku text NOT NULL,
  display_id text,
  name text NOT NULL,
  description text,
  product_url text,
  image_url text,
  video_url text,
  scraped_image_url text,
  price numeric(12,2) NOT NULL DEFAULT 0,
  last_price numeric,
  landed_price numeric,
  quantity integer NOT NULL DEFAULT 0,
  weight text,
  weight_kg numeric(10,3),
  variants jsonb,
  offers jsonb,
  seller_seen boolean DEFAULT false,
  ai_context text,
  ai_context_scraped_at timestamptz,
  sourcing_request_id uuid,
  active boolean NOT NULL DEFAULT true,
  whatsapp_confirmation_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (seller_id, sku)
);

CREATE TABLE public.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sku text NOT NULL UNIQUE,
  name text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  price numeric(12,2) NOT NULL DEFAULT 0,
  landed_cost numeric(12,2),
  weight_kg numeric(10,3),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.generate_product_sku()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT 'SKU-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
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

CREATE TABLE public.sourcing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES auth.users(id),
  display_id text,
  product_name text NOT NULL,
  product_url text NOT NULL DEFAULT '',
  product_image_url text,
  source_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
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

CREATE TABLE public.sourcing_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sourcing_request_id uuid NOT NULL REFERENCES public.sourcing_requests(id) ON DELETE CASCADE,
  changed_by uuid NOT NULL REFERENCES auth.users(id),
  field_changed text NOT NULL,
  old_value text,
  new_value text,
  action_type text NOT NULL DEFAULT 'update',
  created_at timestamptz NOT NULL DEFAULT now()
);

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

-- ---------------------------------------------------------------------------
-- Orders and confirmation workflow
-- ---------------------------------------------------------------------------

CREATE TABLE public.seller_order_prefixes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  prefix text NOT NULL UNIQUE,
  current_counter integer NOT NULL DEFAULT 0
);

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL UNIQUE,
  order_number text GENERATED ALWAYS AS (order_id) STORED,
  system_id bigint GENERATED BY DEFAULT AS IDENTITY UNIQUE,
  system_number bigint GENERATED ALWAYS AS (system_id) STORED,
  seller_id uuid NOT NULL REFERENCES auth.users(id),
  source text NOT NULL DEFAULT 'manual',
  source_ref text,
  source_sheet_id uuid,
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  customer_phone_normalized text GENERATED ALWAYS AS (public.normalize_phone_key(customer_phone)) STORED,
  customer_city text NOT NULL,
  customer_address text,
  product_name text NOT NULL DEFAULT '',
  product_url text,
  video_url text,
  store_url text,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  price numeric(12,2) NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'PKR',
  weight numeric,
  fragile boolean DEFAULT false,
  offers text,
  is_manual_price boolean NOT NULL DEFAULT false,
  last_price numeric,
  confirmation_status text NOT NULL DEFAULT 'new',
  confirmation_channel text NOT NULL DEFAULT 'agent',
  delivery_status text,
  fulfillment_status text NOT NULL DEFAULT 'pending',
  payment_status text NOT NULL DEFAULT 'cod_pending',
  agent_id uuid REFERENCES auth.users(id),
  original_agent_id uuid REFERENCES auth.users(id),
  assigned_at timestamptz,
  confirmed_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  last_activity_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  attempts_today integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  last_attempt_date date,
  postpone_date timestamptz,
  postpone_note text,
  cancel_reason text,
  agent_switch_scheduled_at timestamptz,
  agent_switched_at timestamptz,
  follow_up_assigned_to uuid,
  follow_up_assigned_at timestamptz,
  follow_up_note text,
  invoice_id uuid,
  shipping_cost numeric,
  shipping_status text,
  shipping_company text,
  shipped_at timestamptz,
  whatsapp_status text,
  whatsapp_last_sent_at timestamptz,
  whatsapp_last_reply_at timestamptz,
  whatsapp_retry_count integer NOT NULL DEFAULT 0,
  whatsapp_note text,
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id),
  product_variant_id uuid REFERENCES public.product_variants(id),
  sku text,
  product_name text NOT NULL,
  variant_name text,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  total_price numeric(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  weight_kg numeric(10,3),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.order_history (
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

CREATE TABLE public.order_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_uuid uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  order_id text,
  event_type text NOT NULL,
  old_value text,
  new_value text,
  note text,
  actor_id uuid REFERENCES auth.users(id),
  actor_role public.app_role,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.order_follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL UNIQUE,
  follow_up_status text NOT NULL DEFAULT 'pending',
  fu_no_answer_count integer NOT NULL DEFAULT 0,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('success', true, 'group_id', p_group_id, 'keep_order_id', p_keep_order_id);
$$;

-- ---------------------------------------------------------------------------
-- Calls, agent activity and assignment helpers
-- ---------------------------------------------------------------------------

CREATE TABLE public.calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL,
  agent_id uuid NOT NULL REFERENCES auth.users(id),
  call_start_time timestamptz NOT NULL DEFAULT now(),
  call_end_time timestamptz,
  duration integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.agent_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES auth.users(id),
  agent_name text,
  activity_type text NOT NULL,
  order_id text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.agent_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES auth.users(id),
  product_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, product_name)
);

CREATE TABLE public.follow_up_seller_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follow_up_user_id uuid NOT NULL REFERENCES auth.users(id),
  seller_id uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (follow_up_user_id, seller_id)
);

CREATE TABLE public.follow_up_product_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follow_up_user_id uuid NOT NULL REFERENCES auth.users(id),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (follow_up_user_id, product_id)
);

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

CREATE OR REPLACE FUNCTION public.generate_seller_display_id(p_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_name text := regexp_replace(coalesce(trim(p_name), ''), '\s+', ' ', 'g');
  v_parts text[];
  v_first text;
  v_last text;
  v_prefix text;
  v_counter integer;
BEGIN
  IF v_clean_name = '' THEN
    v_prefix := 'SE';
  ELSE
    v_parts := string_to_array(v_clean_name, ' ');
    v_first := v_parts[1];
    v_last := COALESCE(v_parts[array_length(v_parts, 1)], v_first);
    v_prefix := upper(left(regexp_replace(v_first, '[^A-Za-z]', '', 'g'), 1) || left(regexp_replace(v_last, '[^A-Za-z]', '', 'g'), 1));
    IF length(v_prefix) < 2 THEN
      v_prefix := upper(left(regexp_replace(v_clean_name, '[^A-Za-z]', '', 'g') || 'SE', 2));
    END IF;
  END IF;

  INSERT INTO public.seller_display_id_counters (prefix, current_counter)
  VALUES (v_prefix, 1)
  ON CONFLICT (prefix)
  DO UPDATE SET current_counter = public.seller_display_id_counters.current_counter + 1
  RETURNING current_counter INTO v_counter;

  RETURN v_prefix || '-' || lpad(v_counter::text, 2, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.release_expired_order_locks()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.orders
  SET agent_id = NULL,
      assigned_at = NULL,
      last_activity_at = NULL,
      updated_at = now()
  WHERE agent_id IS NOT NULL
    AND confirmation_status IN ('new', 'no_answer', 'postponed')
    AND last_activity_at IS NOT NULL
    AND last_activity_at < now() - interval '6 minutes';
$$;

CREATE OR REPLACE FUNCTION public.cleanup_agent_activity_log()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.agent_activity_log
  WHERE created_at < now() - interval '30 days';
$$;

CREATE OR REPLACE FUNCTION public.process_agent_switch_timeouts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.orders
  SET agent_id = NULL,
      assigned_at = NULL,
      agent_switched_at = now(),
      updated_at = now()
  WHERE agent_id IS NOT NULL
    AND confirmation_status IN ('new', 'no_answer', 'postponed')
    AND agent_switch_scheduled_at IS NOT NULL
    AND agent_switch_scheduled_at <= now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_submit_order(
  p_order_id uuid,
  p_confirmation_status text,
  p_agent_id uuid,
  p_assigned_at timestamptz,
  p_last_activity_at timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_customer_city text,
  p_customer_address text,
  p_product_name text,
  p_quantity integer,
  p_price numeric,
  p_total_amount numeric,
  p_is_manual_price boolean,
  p_note text,
  p_attempt_count integer,
  p_original_agent_id uuid DEFAULT NULL,
  p_last_attempt_at timestamptz DEFAULT NULL,
  p_attempts_today integer DEFAULT NULL,
  p_last_attempt_date date DEFAULT NULL,
  p_postpone_date timestamptz DEFAULT NULL,
  p_postpone_note text DEFAULT NULL,
  p_confirmed_at timestamptz DEFAULT NULL,
  p_delivery_status text DEFAULT NULL,
  p_cancel_reason text DEFAULT NULL
)
RETURNS SETOF public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.orders
  SET confirmation_status = p_confirmation_status,
      agent_id = p_agent_id,
      assigned_at = p_assigned_at,
      last_activity_at = p_last_activity_at,
      customer_name = p_customer_name,
      customer_phone = p_customer_phone,
      customer_city = p_customer_city,
      customer_address = p_customer_address,
      product_name = p_product_name,
      quantity = p_quantity,
      price = p_price,
      total_amount = p_total_amount,
      is_manual_price = p_is_manual_price,
      note = p_note,
      attempt_count = p_attempt_count,
      original_agent_id = COALESCE(p_original_agent_id, original_agent_id),
      last_attempt_at = COALESCE(p_last_attempt_at, last_attempt_at),
      attempts_today = COALESCE(p_attempts_today, attempts_today),
      last_attempt_date = COALESCE(p_last_attempt_date, last_attempt_date),
      postpone_date = COALESCE(p_postpone_date, postpone_date),
      postpone_note = COALESCE(p_postpone_note, postpone_note),
      confirmed_at = COALESCE(p_confirmed_at, confirmed_at),
      delivery_status = COALESCE(p_delivery_status, delivery_status),
      cancel_reason = COALESCE(p_cancel_reason, cancel_reason),
      updated_at = now()
  WHERE id = p_order_id
    AND (agent_id = auth.uid() OR public.is_staff(auth.uid()))
  RETURNING *;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_invoice_summary(p_invoice_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice record;
  v_rates record;
  v_rate_settings record;
  v_pkr_rate numeric := 290.0;
  v_total_orders_count integer := 0;
  v_delivered_count integer := 0;
  v_shipped_count integer := 0;
  v_confirmed_count integer := 0;
  v_dropped_count integer := 0;
  v_delivered_revenue_usd numeric := 0;
  v_shipping_fees numeric := 0;
  v_call_center_fees numeric := 0;
  v_cod_fees numeric := 0;
  v_addon_net numeric := 0;
  v_adjustment_net numeric := 0;
  v_delivered_orders jsonb := '[]'::jsonb;
  v_all_orders jsonb := '[]'::jsonb;
  v_shipping_breakdown jsonb := '[]'::jsonb;
  v_addons jsonb := '[]'::jsonb;
  v_adjustments jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  SELECT * INTO v_rates FROM public.seller_rates WHERE user_id = v_invoice.seller_id LIMIT 1;
  SELECT * INTO v_rate_settings
  FROM public.rate_settings
  WHERE (seller_id = v_invoice.seller_id AND is_custom = true)
     OR (seller_id IS NULL AND is_global = true)
  ORDER BY is_custom DESC, is_global DESC
  LIMIT 1;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE delivery_status = 'delivered')::integer,
    count(*) FILTER (WHERE delivery_status IN ('shipped','in_transit','out_for_delivery','delivered'))::integer,
    count(*) FILTER (WHERE confirmation_status = 'confirmed')::integer,
    count(*) FILTER (WHERE confirmation_status IN ('cancelled','dropped','unreachable'))::integer,
    COALESCE(sum(total_amount) FILTER (WHERE delivery_status = 'delivered'), 0) / v_pkr_rate
  INTO v_total_orders_count, v_delivered_count, v_shipped_count, v_confirmed_count, v_dropped_count, v_delivered_revenue_usd
  FROM public.orders
  WHERE invoice_id = p_invoice_id;

  v_call_center_fees :=
    v_confirmed_count * COALESCE(v_rate_settings.confirmed_order_rate, 0) +
    v_dropped_count * COALESCE(v_rate_settings.dropped_order_rate, 0);
  v_cod_fees := v_delivered_revenue_usd * COALESCE(v_rate_settings.cod_fee_per_delivery, 0) / 100;

  WITH order_weights AS (
    SELECT
      o.*,
      COALESCE(p.weight_kg, CASE
        WHEN p.weight = 'up_to_1kg' THEN 0.5
        WHEN p.weight = 'up_to_2kg' THEN 1.5
        WHEN p.weight = 'up_to_3kg' THEN 2.5
        WHEN p.weight = 'above_3kg' THEN 3.5
        ELSE 0.5
      END) AS weight_kg
    FROM public.orders o
    LEFT JOIN public.products p ON p.seller_id = o.seller_id AND p.name = o.product_name
    WHERE o.invoice_id = p_invoice_id
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', id,
      'order_id', order_id,
      'customer_name', customer_name,
      'customer_phone', customer_phone,
      'product_name', product_name,
      'quantity', quantity,
      'price', price,
      'total_amount', total_amount,
      'created_at', created_at,
      'weight_kg', weight_kg,
      'total_weight_kg', weight_kg * quantity,
      'amount_usd', round(total_amount / v_pkr_rate, 2),
      'confirmation_status', confirmation_status,
      'delivery_status', COALESCE(delivery_status, 'none'),
      'has_adjustment', false,
      'adjustment_invoice_id', NULL,
      'adjustment_invoice_number', NULL,
      'was_delivered', delivery_status = 'delivered'
    ) ORDER BY created_at DESC), '[]'::jsonb),
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', id,
      'order_id', order_id,
      'customer_name', customer_name,
      'customer_phone', customer_phone,
      'product_name', product_name,
      'quantity', quantity,
      'price', price,
      'total_amount', total_amount,
      'created_at', created_at,
      'weight_kg', weight_kg,
      'total_weight_kg', weight_kg * quantity,
      'amount_usd', round(total_amount / v_pkr_rate, 2)
    ) ORDER BY created_at DESC) FILTER (WHERE delivery_status = 'delivered'), '[]'::jsonb)
  INTO v_all_orders, v_delivered_orders
  FROM order_weights;

  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC), '[]'::jsonb),
         COALESCE(sum(CASE WHEN a.type = 'deduction' THEN -abs(a.amount) ELSE a.amount END), 0)
  INTO v_addons, v_addon_net
  FROM public.invoice_addons a
  WHERE a.invoice_id = p_invoice_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(adj) ORDER BY adj.created_at DESC), '[]'::jsonb),
         COALESCE(sum(adj.difference_usd + COALESCE(adj.shipping_difference_usd, 0)), 0)
  INTO v_adjustments, v_adjustment_net
  FROM public.invoice_adjustments adj
  WHERE adj.applied_invoice_id = p_invoice_id OR adj.invoice_id = p_invoice_id;

  v_shipping_fees := v_delivered_count * COALESCE(v_rates.rate_1kg, 0);
  v_shipping_breakdown := jsonb_build_array(jsonb_build_object('bracket', 'standard', 'count', v_delivered_count, 'fee', v_shipping_fees));

  RETURN json_build_object(
    'invoice', to_jsonb(v_invoice),
    'rates', jsonb_build_object(
      'shipping', jsonb_build_object(
        'rate_1kg', COALESCE(v_rates.rate_1kg, 0),
        'rate_2kg', COALESCE(v_rates.rate_2kg, 0),
        'rate_3kg', COALESCE(v_rates.rate_3kg, 0),
        'rate_3kg_plus', COALESCE(v_rates.rate_3kg_plus, 0)
      ),
      'call_center', jsonb_build_object(
        'confirmed_rate', COALESCE(v_rate_settings.confirmed_order_rate, 0),
        'dropped_rate', COALESCE(v_rate_settings.dropped_order_rate, 0)
      ),
      'cod_fee_percentage', COALESCE(v_rate_settings.cod_fee_per_delivery, 0)
    ),
    'counts', jsonb_build_object(
      'total_orders_count', v_total_orders_count,
      'delivered_count', v_delivered_count,
      'shipped_count', v_shipped_count,
      'confirmed_count', v_confirmed_count,
      'dropped_count', v_dropped_count,
      'cross_shipped_count', 0,
      'cross_delivered_count', 0,
      'cross_confirmed_count', 0
    ),
    'call_center_breakdown', jsonb_build_object(
      'confirmed_count', v_confirmed_count,
      'confirmed_rate', COALESCE(v_rate_settings.confirmed_order_rate, 0),
      'confirmed_fees', v_confirmed_count * COALESCE(v_rate_settings.confirmed_order_rate, 0),
      'dropped_count', v_dropped_count,
      'dropped_rate', COALESCE(v_rate_settings.dropped_order_rate, 0),
      'dropped_fees', v_dropped_count * COALESCE(v_rate_settings.dropped_order_rate, 0)
    ),
    'delivered_orders', v_delivered_orders,
    'all_orders', v_all_orders,
    'shipping_breakdown', v_shipping_breakdown,
    'addons', v_addons,
    'adjustments', v_adjustments,
    'totals', jsonb_build_object(
      'delivered_revenue_usd', round(v_delivered_revenue_usd, 2),
      'shipping_fees', v_shipping_fees,
      'call_center_fees', v_call_center_fees,
      'cod_fees', v_cod_fees,
      'addon_net', v_addon_net,
      'adjustment_net', v_adjustment_net,
      'previous_balance', COALESCE(v_invoice.previous_balance, 0),
      'net_payable', round(v_delivered_revenue_usd - v_shipping_fees - v_call_center_fees - v_cod_fees + v_addon_net + v_adjustment_net + COALESCE(v_invoice.previous_balance, 0), 2)
    )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Google Sheets import
-- ---------------------------------------------------------------------------

CREATE TABLE public.integration_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES auth.users(id),
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

CREATE TABLE public.integration_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id uuid NOT NULL REFERENCES public.integration_sheets(id) ON DELETE CASCADE,
  order_data jsonb,
  error_message text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Shipping redesign: carriers, shipments, fulfillment, inventory
-- ---------------------------------------------------------------------------

CREATE TABLE public.carriers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  fulfillment_mode public.carrier_fulfillment_mode NOT NULL DEFAULT 'carrier_managed',
  supports_cod boolean NOT NULL DEFAULT true,
  supports_tracking boolean NOT NULL DEFAULT true,
  supports_bulk_tracking boolean NOT NULL DEFAULT false,
  supports_labels boolean NOT NULL DEFAULT false,
  supports_load_sheet boolean NOT NULL DEFAULT false,
  supports_cancel boolean NOT NULL DEFAULT false,
  supports_payment_status boolean NOT NULL DEFAULT false,
  priority integer NOT NULL DEFAULT 100,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.carrier_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id uuid NOT NULL REFERENCES public.carriers(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Default',
  account_number text,
  api_token_secret_name text,
  enabled boolean NOT NULL DEFAULT true,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (carrier_id, name)
);

CREATE TABLE public.carrier_city_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id uuid NOT NULL REFERENCES public.carriers(id) ON DELETE CASCADE,
  carrier_city_id text,
  city_name text NOT NULL,
  province_name text,
  country_name text NOT NULL DEFAULT 'Pakistan',
  is_pickup_city boolean,
  is_delivery_city boolean,
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  cached_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX carrier_city_cache_carrier_city_unique
  ON public.carrier_city_cache(carrier_id, lower(city_name));

CREATE TABLE public.carrier_pickup_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id uuid NOT NULL REFERENCES public.carriers(id) ON DELETE CASCADE,
  carrier_account_id uuid REFERENCES public.carrier_accounts(id) ON DELETE SET NULL,
  address_code text,
  name text NOT NULL,
  contact_person_name text,
  phone1 text,
  phone2 text,
  city_name text NOT NULL,
  address text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.shipping_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  enabled boolean NOT NULL DEFAULT true,
  carrier_id uuid NOT NULL REFERENCES public.carriers(id),
  fulfillment_mode public.carrier_fulfillment_mode,
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_uuid uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_id text NOT NULL,
  carrier_id uuid NOT NULL REFERENCES public.carriers(id),
  carrier_account_id uuid REFERENCES public.carrier_accounts(id),
  pickup_address_id uuid REFERENCES public.carrier_pickup_addresses(id),
  carrier_order_id text,
  tracking_number text,
  carrier_reference text,
  carrier_status text,
  normalized_status text NOT NULL DEFAULT 'booked',
  sync_status public.shipment_sync_status NOT NULL DEFAULT 'pending',
  sync_error text,
  label_status text,
  booked_at timestamptz,
  last_synced_at timestamptz,
  raw_create_response jsonb,
  raw_tracking_response jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.shipment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  carrier_status text,
  normalized_status text,
  message text,
  location text,
  carrier_event_code text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  raw_event jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.shipment_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  carrier_id uuid NOT NULL REFERENCES public.carriers(id),
  tracking_number text,
  label_url text,
  label_file_path text,
  label_format text NOT NULL DEFAULT 'pdf',
  printed_at timestamptz,
  print_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.shipment_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL UNIQUE REFERENCES public.shipments(id) ON DELETE CASCADE,
  settled boolean NOT NULL DEFAULT false,
  settlement_date date,
  upfront_payment_date date,
  reserve_payment_date date,
  cpr_number_1 text,
  cpr_number_2 text,
  raw_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.fulfillment_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number text NOT NULL UNIQUE,
  carrier_id uuid REFERENCES public.carriers(id),
  status public.fulfillment_batch_status NOT NULL DEFAULT 'open',
  pickup_address_id uuid REFERENCES public.carrier_pickup_addresses(id),
  pickup_date date,
  load_sheet_url text,
  created_by uuid REFERENCES auth.users(id),
  closed_by uuid REFERENCES auth.users(id),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.fulfillment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid REFERENCES public.fulfillment_batches(id) ON DELETE SET NULL,
  order_uuid uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_id text NOT NULL,
  shipment_id uuid NOT NULL UNIQUE REFERENCES public.shipments(id) ON DELETE CASCADE,
  status public.fulfillment_item_status NOT NULL DEFAULT 'pending',
  picked_at timestamptz,
  packed_at timestamptz,
  label_printed_at timestamptz,
  scanned_at timestamptz,
  packed_by uuid REFERENCES auth.users(id),
  scanned_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.inventory_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  type public.inventory_location_type NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.inventory_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_variant_id uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE CASCADE,
  quantity_on_hand integer NOT NULL DEFAULT 0,
  quantity_reserved integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_variant_id, location_id)
);

CREATE TABLE public.scan_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid REFERENCES public.shipments(id) ON DELETE SET NULL,
  batch_id uuid REFERENCES public.fulfillment_batches(id) ON DELETE SET NULL,
  tracking_number text NOT NULL,
  scan_type public.scan_type NOT NULL,
  result public.scan_result NOT NULL DEFAULT 'ok',
  message text,
  scanned_by uuid REFERENCES auth.users(id),
  scanned_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_variant_id uuid NOT NULL REFERENCES public.product_variants(id),
  order_uuid uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  order_id text,
  shipment_id uuid REFERENCES public.shipments(id) ON DELETE SET NULL,
  scan_event_id uuid REFERENCES public.scan_events(id) ON DELETE SET NULL,
  movement_type public.inventory_movement_type NOT NULL,
  quantity_change integer NOT NULL CHECK (quantity_change <> 0),
  from_location_id uuid REFERENCES public.inventory_locations(id),
  to_location_id uuid REFERENCES public.inventory_locations(id),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.return_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL UNIQUE REFERENCES public.shipments(id) ON DELETE CASCADE,
  order_uuid uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_id text NOT NULL,
  scan_event_id uuid REFERENCES public.scan_events(id),
  condition public.return_condition NOT NULL,
  status text NOT NULL DEFAULT 'return_received',
  received_by uuid REFERENCES auth.users(id),
  received_at timestamptz NOT NULL DEFAULT now(),
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.return_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_receipt_id uuid NOT NULL REFERENCES public.return_receipts(id) ON DELETE CASCADE,
  order_item_id uuid REFERENCES public.order_items(id),
  product_variant_id uuid REFERENCES public.product_variants(id),
  expected_quantity integer NOT NULL DEFAULT 0,
  received_quantity integer NOT NULL DEFAULT 0,
  condition public.return_condition NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- WhatsApp module, unchanged shape from the old app
-- ---------------------------------------------------------------------------

CREATE TABLE public.whatsapp_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name text NOT NULL DEFAULT 'meta_cloud',
  api_base_url text NOT NULL DEFAULT 'https://graph.facebook.com/v21.0',
  phone_number_id text,
  waba_id text,
  sender_number text,
  webhook_secret text,
  access_token text,
  default_country_code text NOT NULL DEFAULT '92',
  max_retries integer NOT NULL DEFAULT 2,
  integration_enabled boolean NOT NULL DEFAULT false,
  sending_enabled boolean NOT NULL DEFAULT true,
  receiving_enabled boolean NOT NULL DEFAULT false,
  auto_book_shipping boolean NOT NULL DEFAULT false,
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL DEFAULT 'first_message',
  language text NOT NULL DEFAULT 'en',
  meta_template_name text,
  body text NOT NULL DEFAULT '',
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  category text NOT NULL DEFAULT 'UTILITY',
  header_type text DEFAULT 'NONE',
  header_text text,
  header_media_url text,
  footer text,
  buttons jsonb NOT NULL DEFAULT '[]'::jsonb,
  sync_status text NOT NULL DEFAULT 'LOCAL',
  meta_template_id text,
  rejection_reason text,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.whatsapp_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text,
  order_uuid uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  customer_phone text NOT NULL,
  customer_phone_normalized text GENERATED ALWAYS AS (public.normalize_phone_key(customer_phone)) STORED,
  customer_name text,
  status text NOT NULL DEFAULT 'open',
  outcome text,
  labels text[] NOT NULL DEFAULT '{}',
  ai_enabled boolean NOT NULL DEFAULT true,
  pending_button_intent jsonb,
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  last_reply_at timestamptz,
  last_read_at timestamptz,
  resolved_by uuid,
  resolved_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  order_id text,
  order_uuid uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  direction text NOT NULL,
  message_type text NOT NULL DEFAULT 'text',
  body text,
  meta_message_id text,
  status text,
  error_message text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.whatsapp_automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'Untitled',
  description text,
  status text NOT NULL DEFAULT 'draft',
  trigger_type text NOT NULL,
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  nodes jsonb NOT NULL DEFAULT '[]'::jsonb,
  edges jsonb NOT NULL DEFAULT '[]'::jsonb,
  runs_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  last_run_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.whatsapp_automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid NOT NULL REFERENCES public.whatsapp_automations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  trigger_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  steps_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_message text,
  customer_phone text,
  order_id text,
  conversation_id uuid,
  current_node_id text,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  wait_until timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE public.whatsapp_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  template_id uuid REFERENCES public.whatsapp_templates(id) ON DELETE SET NULL,
  template_name text,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  audience_source text NOT NULL DEFAULT 'orders',
  send_mode text NOT NULL DEFAULT 'immediate',
  scheduled_at timestamptz,
  throttle_per_minute integer NOT NULL DEFAULT 30,
  total_recipients integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  delivered_count integer NOT NULL DEFAULT 0,
  read_count integer NOT NULL DEFAULT 0,
  replied_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.whatsapp_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.whatsapp_campaigns(id) ON DELETE CASCADE,
  order_id text,
  customer_phone text NOT NULL,
  customer_name text,
  variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  message_id uuid REFERENCES public.whatsapp_messages(id) ON DELETE SET NULL,
  meta_message_id text,
  conversation_id uuid,
  error_message text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  replied_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.whatsapp_ai_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  system_prompt text NOT NULL DEFAULT 'You are a professional WhatsApp sales and customer support agent.',
  brand_tone text NOT NULL DEFAULT 'friendly',
  language_rules text NOT NULL DEFAULT 'Detect user language and reply in the same language.',
  product_context text NOT NULL DEFAULT 'Prioritize products from the database.',
  model text NOT NULL DEFAULT 'google/gemini-2.5-flash',
  temperature numeric NOT NULL DEFAULT 0.7,
  confidence_threshold numeric NOT NULL DEFAULT 0.85,
  max_tokens integer NOT NULL DEFAULT 512,
  response_lines integer NOT NULL DEFAULT 3,
  suggested_replies_enabled boolean NOT NULL DEFAULT true,
  full_auto_reply_enabled boolean NOT NULL DEFAULT false,
  intent_detection_enabled boolean NOT NULL DEFAULT true,
  sentiment_analysis_enabled boolean NOT NULL DEFAULT true,
  lead_qualification_enabled boolean NOT NULL DEFAULT true,
  order_tracking_enabled boolean NOT NULL DEFAULT true,
  ai_memory_enabled boolean NOT NULL DEFAULT true,
  smart_follow_up_enabled boolean NOT NULL DEFAULT false,
  language_detection_enabled boolean NOT NULL DEFAULT true,
  ai_image_analysis_enabled boolean NOT NULL DEFAULT true,
  voice_transcription_enabled boolean NOT NULL DEFAULT true,
  ai_voice_response_enabled boolean NOT NULL DEFAULT false,
  smart_follow_up_idle_hours integer NOT NULL DEFAULT 24,
  ai_batch_wait_seconds integer NOT NULL DEFAULT 20,
  ai_dedup_window_seconds integer NOT NULL DEFAULT 30,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

CREATE TABLE public.whatsapp_ai_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_phone text NOT NULL UNIQUE,
  conversation_id uuid REFERENCES public.whatsapp_conversations(id) ON DELETE SET NULL,
  summary text,
  language text,
  sentiment text,
  intent text,
  lead_score integer DEFAULT 0,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_interaction_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.whatsapp_ai_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.whatsapp_messages(id) ON DELETE CASCADE,
  suggestions jsonb NOT NULL DEFAULT '[]'::jsonb,
  intent text,
  sentiment text,
  language text,
  confidence numeric,
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Invoices, rates, seller payments
-- ---------------------------------------------------------------------------

CREATE TABLE public.seller_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  rate_1kg numeric NOT NULL DEFAULT 35,
  rate_2kg numeric NOT NULL DEFAULT 45,
  rate_3kg numeric NOT NULL DEFAULT 55,
  rate_3kg_plus numeric NOT NULL DEFAULT 70
);

CREATE TABLE public.rate_settings (
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

CREATE TABLE public.seller_payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  method text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  cih_account_name text,
  cih_rib text,
  binance_id text,
  binance_wallet_address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.seller_invoice_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  current_counter integer NOT NULL DEFAULT 0
);

CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  seller_id uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'draft',
  period_start date,
  period_end date,
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  fees_total numeric(12,2) NOT NULL DEFAULT 0,
  adjustments_total numeric(12,2) NOT NULL DEFAULT 0,
  net_payable numeric(12,2) NOT NULL DEFAULT 0,
  previous_balance numeric NOT NULL DEFAULT 0,
  payment_proof_url text,
  finalized_at timestamptz,
  paid_at timestamptz,
  paid_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.orders
  ADD CONSTRAINT orders_invoice_id_fkey
  FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;

CREATE TABLE public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  order_uuid uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  order_id text,
  shipment_id uuid REFERENCES public.shipments(id) ON DELETE SET NULL,
  description text NOT NULL,
  amount numeric(12,2) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.invoice_addons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  type text NOT NULL DEFAULT 'addon',
  reason text NOT NULL DEFAULT '',
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.invoice_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES auth.users(id),
  order_id text NOT NULL,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  applied_invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  type text NOT NULL DEFAULT 'status_change',
  status text NOT NULL DEFAULT 'pending',
  amount numeric(12,2) NOT NULL DEFAULT 0,
  previous_amount numeric NOT NULL DEFAULT 0,
  new_amount numeric NOT NULL DEFAULT 0,
  difference numeric NOT NULL DEFAULT 0,
  previous_shipping_fee numeric NOT NULL DEFAULT 0,
  new_shipping_fee numeric NOT NULL DEFAULT 0,
  shipping_difference numeric NOT NULL DEFAULT 0,
  old_status text,
  new_status text,
  reason text,
  created_by uuid REFERENCES auth.users(id),
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.invoice_history (
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

-- ---------------------------------------------------------------------------
-- Support
-- ---------------------------------------------------------------------------

CREATE TABLE public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES auth.users(id),
  issue_type text NOT NULL DEFAULT 'general',
  related_id text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id),
  sender_type text NOT NULL DEFAULT 'seller',
  message text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Read models, dashboard metrics, RPCs
-- ---------------------------------------------------------------------------

CREATE TABLE public.daily_order_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_date date NOT NULL,
  seller_id uuid,
  carrier_id uuid,
  product_id uuid,
  dimension_key text GENERATED ALWAYS AS (
    COALESCE(seller_id::text, 'all') || ':' ||
    COALESCE(carrier_id::text, 'all') || ':' ||
    COALESCE(product_id::text, 'all')
  ) STORED,
  orders_created integer NOT NULL DEFAULT 0,
  orders_confirmed integer NOT NULL DEFAULT 0,
  orders_cancelled integer NOT NULL DEFAULT 0,
  shipments_booked integer NOT NULL DEFAULT 0,
  shipments_shipped integer NOT NULL DEFAULT 0,
  shipments_delivered integer NOT NULL DEFAULT 0,
  shipments_returned integer NOT NULL DEFAULT 0,
  gross_revenue numeric(14,2) NOT NULL DEFAULT 0,
  delivered_revenue numeric(14,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (metric_date, dimension_key)
);

CREATE OR REPLACE VIEW public.order_list_view AS
SELECT
  o.id,
  o.order_id,
  o.order_number,
  o.system_id,
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
  s.tracking_number,
  c.code AS carrier_code,
  c.name AS carrier_name,
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
  WHERE sh.order_uuid = o.id
  ORDER BY sh.created_at DESC, sh.id DESC
  LIMIT 1
) s ON true
LEFT JOIN public.carriers c ON c.id = s.carrier_id;

CREATE OR REPLACE VIEW public.fulfillment_queue_view AS
SELECT
  fi.id AS fulfillment_item_id,
  fi.status AS fulfillment_item_status,
  fi.batch_id,
  fb.batch_number,
  o.id AS order_uuid,
  o.order_id,
  o.system_id,
  o.customer_name,
  o.customer_city,
  o.total_amount,
  sh.id AS shipment_id,
  sh.tracking_number,
  sh.normalized_status,
  c.id AS carrier_id,
  c.code AS carrier_code,
  c.name AS carrier_name,
  fi.created_at,
  fi.updated_at,
  COALESCE(items.product_names, o.product_name) AS product_name,
  COALESCE(items.item_count, 1) AS item_count
FROM public.fulfillment_items fi
JOIN public.orders o ON o.id = fi.order_uuid
JOIN public.shipments sh ON sh.id = fi.shipment_id
JOIN public.carriers c ON c.id = sh.carrier_id
LEFT JOIN public.fulfillment_batches fb ON fb.id = fi.batch_id
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)::integer AS item_count,
    string_agg(DISTINCT oi.product_name, ', ' ORDER BY oi.product_name) AS product_names
  FROM public.order_items oi
  WHERE oi.order_id = o.id
) items ON true;

CREATE OR REPLACE VIEW public.inventory_balance_view AS
SELECT
  ib.id,
  ib.product_variant_id,
  pv.sku,
  COALESCE(pv.name, p.name) AS variant_name,
  p.id AS product_id,
  p.name AS product_name,
  p.seller_id,
  il.id AS location_id,
  il.code AS location_code,
  il.name AS location_name,
  il.type AS location_type,
  ib.quantity_on_hand,
  ib.quantity_reserved,
  ib.updated_at
FROM public.inventory_balances ib
JOIN public.product_variants pv ON pv.id = ib.product_variant_id
JOIN public.products p ON p.id = pv.product_id
JOIN public.inventory_locations il ON il.id = ib.location_id;

CREATE OR REPLACE VIEW public.returns_queue_view AS
SELECT
  rr.id AS return_receipt_id,
  rr.status,
  rr.condition,
  rr.received_at,
  o.id AS order_uuid,
  o.order_id,
  o.system_id,
  o.customer_name,
  sh.id AS shipment_id,
  sh.tracking_number,
  c.code AS carrier_code,
  c.name AS carrier_name
FROM public.return_receipts rr
JOIN public.orders o ON o.id = rr.order_uuid
JOIN public.shipments sh ON sh.id = rr.shipment_id
JOIN public.carriers c ON c.id = sh.carrier_id;

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
      OR v.order_id ILIKE '%' || p_search || '%'
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

CREATE OR REPLACE FUNCTION public.get_fulfillment_queue(
  p_limit integer DEFAULT 50,
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_carrier_id uuid DEFAULT NULL,
  p_status public.fulfillment_item_status DEFAULT NULL
)
RETURNS SETOF public.fulfillment_queue_view
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.fulfillment_queue_view v
  WHERE (p_carrier_id IS NULL OR v.carrier_id = p_carrier_id)
    AND (p_status IS NULL OR v.fulfillment_item_status = p_status)
    AND (
      p_cursor_created_at IS NULL
      OR (v.created_at, v.fulfillment_item_id) < (p_cursor_created_at, p_cursor_id)
    )
  ORDER BY v.created_at DESC, v.fulfillment_item_id DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 200);
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
  shipment_id uuid,
  tracking_number text,
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
    COALESCE(s.carrier_status, o.shipping_status) AS shipping_status,
    COALESCE(c.name, o.shipping_company) AS shipping_company,
    s.id AS shipment_id,
    s.tracking_number,
    COALESCE(o.shipped_at, s.booked_at) AS shipped_at,
    CASE WHEN COALESCE(o.shipped_at, s.booked_at) IS NOT NULL
      THEN GREATEST(0, EXTRACT(DAY FROM (now() - COALESCE(o.shipped_at, s.booked_at)))::integer)
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
  LEFT JOIN LATERAL (
    SELECT sh.*
    FROM public.shipments sh
    WHERE sh.order_uuid = o.id
    ORDER BY sh.created_at DESC, sh.id DESC
    LIMIT 1
  ) s ON true
  LEFT JOIN public.carriers c ON c.id = s.carrier_id
  LEFT JOIN public.profiles sp ON sp.user_id = o.seller_id
  LEFT JOIN public.profiles ap ON ap.user_id = o.agent_id
  WHERE o.delivery_status IN ('booked','shipped','in_transit','out_for_delivery','with_courier','delivered','failed_attempt','returned','return','ready_for_return','return_received')
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
  WHERE delivery_status IN ('booked','shipped','in_transit','out_for_delivery','with_courier','delivered','failed_attempt','returned','return','ready_for_return','return_received');
$$;

CREATE OR REPLACE FUNCTION public.refresh_daily_order_metrics(
  p_from date DEFAULT CURRENT_DATE - 30,
  p_to date DEFAULT CURRENT_DATE
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.daily_order_metrics
  WHERE metric_date BETWEEN p_from AND p_to;

  INSERT INTO public.daily_order_metrics (
    metric_date, seller_id, carrier_id, product_id,
    orders_created, orders_confirmed, orders_cancelled,
    shipments_booked, shipments_shipped, shipments_delivered, shipments_returned,
    gross_revenue, delivered_revenue
  )
  SELECT
    d.metric_date,
    d.seller_id,
    d.carrier_id,
    d.product_id,
    COUNT(DISTINCT d.order_uuid) FILTER (WHERE d.created_on_metric_date)::integer,
    COUNT(DISTINCT d.order_uuid) FILTER (WHERE d.confirmed_on_metric_date)::integer,
    COUNT(DISTINCT d.order_uuid) FILTER (WHERE d.cancelled_on_metric_date)::integer,
    COUNT(DISTINCT d.shipment_id) FILTER (WHERE d.shipment_booked_on_metric_date)::integer,
    COUNT(DISTINCT d.shipment_id) FILTER (WHERE d.shipment_shipped_on_metric_date)::integer,
    COUNT(DISTINCT d.shipment_id) FILTER (WHERE d.shipment_delivered_on_metric_date)::integer,
    COUNT(DISTINCT d.shipment_id) FILTER (WHERE d.shipment_returned_on_metric_date)::integer,
    COALESCE(SUM(d.total_amount) FILTER (WHERE d.created_on_metric_date), 0),
    COALESCE(SUM(d.total_amount) FILTER (WHERE d.shipment_delivered_on_metric_date), 0)
  FROM (
    SELECT
      gs::date AS metric_date,
      o.id AS order_uuid,
      o.seller_id,
      sh.id AS shipment_id,
      sh.carrier_id,
      oi.product_id,
      o.total_amount,
      o.created_at::date = gs::date AS created_on_metric_date,
      o.confirmed_at::date = gs::date AS confirmed_on_metric_date,
      o.cancelled_at::date = gs::date AS cancelled_on_metric_date,
      sh.booked_at::date = gs::date AS shipment_booked_on_metric_date,
      sh.created_at::date = gs::date AND sh.normalized_status IN ('shipped','in_transit','out_for_delivery','delivered','ready_for_return','return_in_transit','returned') AS shipment_shipped_on_metric_date,
      o.delivered_at::date = gs::date AS shipment_delivered_on_metric_date,
      sh.updated_at::date = gs::date AND sh.normalized_status IN ('return_received','returned') AS shipment_returned_on_metric_date
    FROM generate_series(p_from, p_to, interval '1 day') gs
    JOIN public.orders o ON (
      o.created_at::date = gs::date
      OR o.confirmed_at::date = gs::date
      OR o.cancelled_at::date = gs::date
      OR o.delivered_at::date = gs::date
    )
    LEFT JOIN public.shipments sh ON sh.order_uuid = o.id
    LEFT JOIN public.order_items oi ON oi.order_id = o.id
  ) d
  GROUP BY d.metric_date, d.seller_id, d.carrier_id, d.product_id
  ON CONFLICT (metric_date, dimension_key)
  DO UPDATE SET
    orders_created = EXCLUDED.orders_created,
    orders_confirmed = EXCLUDED.orders_confirmed,
    orders_cancelled = EXCLUDED.orders_cancelled,
    shipments_booked = EXCLUDED.shipments_booked,
    shipments_shipped = EXCLUDED.shipments_shipped,
    shipments_delivered = EXCLUDED.shipments_delivered,
    shipments_returned = EXCLUDED.shipments_returned,
    gross_revenue = EXCLUDED.gross_revenue,
    delivered_revenue = EXCLUDED.delivered_revenue,
    updated_at = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_dashboard_metrics(
  p_from date DEFAULT CURRENT_DATE - 30,
  p_to date DEFAULT CURRENT_DATE,
  p_seller_id uuid DEFAULT NULL,
  p_carrier_id uuid DEFAULT NULL
)
RETURNS TABLE (
  metric_date date,
  orders_created integer,
  orders_confirmed integer,
  orders_cancelled integer,
  shipments_booked integer,
  shipments_shipped integer,
  shipments_delivered integer,
  shipments_returned integer,
  gross_revenue numeric,
  delivered_revenue numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.metric_date,
    COALESCE(SUM(m.orders_created), 0)::integer,
    COALESCE(SUM(m.orders_confirmed), 0)::integer,
    COALESCE(SUM(m.orders_cancelled), 0)::integer,
    COALESCE(SUM(m.shipments_booked), 0)::integer,
    COALESCE(SUM(m.shipments_shipped), 0)::integer,
    COALESCE(SUM(m.shipments_delivered), 0)::integer,
    COALESCE(SUM(m.shipments_returned), 0)::integer,
    COALESCE(SUM(m.gross_revenue), 0),
    COALESCE(SUM(m.delivered_revenue), 0)
  FROM generate_series(p_from, p_to, interval '1 day') AS d(metric_date)
  LEFT JOIN public.daily_order_metrics m
    ON m.metric_date = d.metric_date::date
    AND (p_seller_id IS NULL OR m.seller_id = p_seller_id)
    AND (p_carrier_id IS NULL OR m.carrier_id = p_carrier_id)
  GROUP BY d.metric_date
  ORDER BY d.metric_date;
$$;

-- ---------------------------------------------------------------------------
-- Scan RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.scan_outbound_shipment(
  p_tracking_number text,
  p_scanned_by uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shipment public.shipments%ROWTYPE;
  v_scan_id uuid;
  v_main_location uuid;
  v_existing integer;
  v_item record;
BEGIN
  SELECT * INTO v_shipment
  FROM public.shipments
  WHERE tracking_number = p_tracking_number
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.scan_events (tracking_number, scan_type, result, message, scanned_by)
    VALUES (p_tracking_number, 'outbound', 'unknown', 'Unknown tracking number', p_scanned_by)
    RETURNING id INTO v_scan_id;
    RETURN jsonb_build_object('ok', false, 'result', 'unknown', 'scan_event_id', v_scan_id);
  END IF;

  SELECT COUNT(*) INTO v_existing
  FROM public.inventory_movements
  WHERE shipment_id = v_shipment.id AND movement_type = 'ship';

  IF v_existing > 0 THEN
    INSERT INTO public.scan_events (shipment_id, tracking_number, scan_type, result, message, scanned_by)
    VALUES (v_shipment.id, p_tracking_number, 'outbound', 'duplicate', 'Shipment already scanned for outbound stock movement', p_scanned_by)
    RETURNING id INTO v_scan_id;
    RETURN jsonb_build_object('ok', true, 'result', 'duplicate', 'shipment_id', v_shipment.id, 'scan_event_id', v_scan_id);
  END IF;

  SELECT id INTO v_main_location FROM public.inventory_locations WHERE code = 'MAIN' LIMIT 1;
  IF v_main_location IS NULL THEN RAISE EXCEPTION 'Inventory location MAIN is missing'; END IF;

  INSERT INTO public.scan_events (shipment_id, tracking_number, scan_type, result, scanned_by)
  VALUES (v_shipment.id, p_tracking_number, 'outbound', 'ok', p_scanned_by)
  RETURNING id INTO v_scan_id;

  FOR v_item IN
    SELECT oi.product_variant_id, oi.quantity
    FROM public.order_items oi
    WHERE oi.order_id = v_shipment.order_uuid AND oi.product_variant_id IS NOT NULL
  LOOP
    INSERT INTO public.inventory_movements (
      product_variant_id, order_uuid, order_id, shipment_id, scan_event_id, movement_type,
      quantity_change, from_location_id, created_by
    )
    VALUES (
      v_item.product_variant_id, v_shipment.order_uuid, v_shipment.order_id, v_shipment.id, v_scan_id, 'ship',
      -v_item.quantity, v_main_location, p_scanned_by
    );

    INSERT INTO public.inventory_balances (product_variant_id, location_id, quantity_on_hand)
    VALUES (v_item.product_variant_id, v_main_location, -v_item.quantity)
    ON CONFLICT (product_variant_id, location_id)
    DO UPDATE SET quantity_on_hand = public.inventory_balances.quantity_on_hand - v_item.quantity, updated_at = now();
  END LOOP;

  UPDATE public.fulfillment_items
  SET status = 'scanned',
      picked_at = COALESCE(picked_at, now()),
      packed_at = COALESCE(packed_at, now()),
      label_printed_at = COALESCE(label_printed_at, now()),
      scanned_at = now(),
      packed_by = COALESCE(packed_by, p_scanned_by),
      scanned_by = p_scanned_by,
      updated_at = now()
  WHERE shipment_id = v_shipment.id;

  UPDATE public.orders
  SET fulfillment_status = 'scanned', updated_at = now()
  WHERE id = v_shipment.order_uuid;

  RETURN jsonb_build_object('ok', true, 'result', 'ok', 'shipment_id', v_shipment.id, 'scan_event_id', v_scan_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.scan_return_shipment(
  p_tracking_number text,
  p_condition public.return_condition,
  p_scanned_by uuid DEFAULT auth.uid(),
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shipment public.shipments%ROWTYPE;
  v_scan_id uuid;
  v_location uuid;
  v_existing integer;
  v_receipt_id uuid;
  v_item record;
BEGIN
  SELECT * INTO v_shipment
  FROM public.shipments
  WHERE tracking_number = p_tracking_number
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.scan_events (tracking_number, scan_type, result, message, scanned_by)
    VALUES (p_tracking_number, 'return', 'unknown', 'Unknown return tracking number', p_scanned_by)
    RETURNING id INTO v_scan_id;
    RETURN jsonb_build_object('ok', false, 'result', 'unknown', 'scan_event_id', v_scan_id);
  END IF;

  SELECT COUNT(*) INTO v_existing FROM public.return_receipts WHERE shipment_id = v_shipment.id;
  IF v_existing > 0 THEN
    INSERT INTO public.scan_events (shipment_id, tracking_number, scan_type, result, message, scanned_by)
    VALUES (v_shipment.id, p_tracking_number, 'return', 'duplicate', 'Return already received', p_scanned_by)
    RETURNING id INTO v_scan_id;
    RETURN jsonb_build_object('ok', true, 'result', 'duplicate', 'shipment_id', v_shipment.id, 'scan_event_id', v_scan_id);
  END IF;

  SELECT id INTO v_location
  FROM public.inventory_locations
  WHERE code = CASE WHEN p_condition = 'sellable' THEN 'MAIN' WHEN p_condition = 'damaged' THEN 'DAMAGED' ELSE 'RETURNS' END
  LIMIT 1;
  IF v_location IS NULL THEN RAISE EXCEPTION 'Required return inventory location is missing'; END IF;

  INSERT INTO public.scan_events (shipment_id, tracking_number, scan_type, result, scanned_by)
  VALUES (v_shipment.id, p_tracking_number, 'return', 'ok', p_scanned_by)
  RETURNING id INTO v_scan_id;

  INSERT INTO public.return_receipts (shipment_id, order_uuid, order_id, scan_event_id, condition, received_by, note)
  VALUES (v_shipment.id, v_shipment.order_uuid, v_shipment.order_id, v_scan_id, p_condition, p_scanned_by, p_note)
  RETURNING id INTO v_receipt_id;

  FOR v_item IN
    SELECT oi.id AS order_item_id, oi.product_variant_id, oi.quantity
    FROM public.order_items oi
    WHERE oi.order_id = v_shipment.order_uuid AND oi.product_variant_id IS NOT NULL
  LOOP
    INSERT INTO public.return_receipt_items (
      return_receipt_id, order_item_id, product_variant_id, expected_quantity, received_quantity, condition
    )
    VALUES (v_receipt_id, v_item.order_item_id, v_item.product_variant_id, v_item.quantity, v_item.quantity, p_condition);

    INSERT INTO public.inventory_movements (
      product_variant_id, order_uuid, order_id, shipment_id, scan_event_id, movement_type,
      quantity_change, to_location_id, created_by
    )
    VALUES (
      v_item.product_variant_id, v_shipment.order_uuid, v_shipment.order_id, v_shipment.id, v_scan_id,
      CASE WHEN p_condition = 'sellable' THEN 'restock' ELSE 'return_received' END,
      v_item.quantity, v_location, p_scanned_by
    );

    INSERT INTO public.inventory_balances (product_variant_id, location_id, quantity_on_hand)
    VALUES (v_item.product_variant_id, v_location, v_item.quantity)
    ON CONFLICT (product_variant_id, location_id)
    DO UPDATE SET quantity_on_hand = public.inventory_balances.quantity_on_hand + v_item.quantity, updated_at = now();
  END LOOP;

  UPDATE public.shipments SET normalized_status = 'return_received', updated_at = now() WHERE id = v_shipment.id;
  UPDATE public.orders
  SET delivery_status = 'return_received',
      fulfillment_status = CASE
        WHEN p_condition = 'sellable' THEN 'restocked'
        WHEN p_condition = 'damaged' THEN 'damaged_return'
        WHEN p_condition = 'missing_item' THEN 'missing_return'
        ELSE 'return_inspection'
      END,
      updated_at = now()
  WHERE id = v_shipment.order_uuid;

  RETURN jsonb_build_object('ok', true, 'result', 'ok', 'shipment_id', v_shipment.id, 'scan_event_id', v_scan_id, 'return_receipt_id', v_receipt_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX idx_profiles_user_id ON public.profiles(user_id);
CREATE INDEX idx_user_roles_role_user ON public.user_roles(role, user_id);
CREATE INDEX idx_products_seller_active ON public.products(seller_id, active, created_at DESC);
CREATE INDEX idx_products_name_trgm ON public.products USING gin (name gin_trgm_ops);
CREATE INDEX idx_product_variants_product ON public.product_variants(product_id);
CREATE INDEX idx_orders_created_cursor ON public.orders(created_at DESC, id DESC);
CREATE INDEX idx_orders_seller_created ON public.orders(seller_id, created_at DESC, id DESC);
CREATE INDEX idx_orders_confirmation_created ON public.orders(confirmation_status, created_at DESC, id DESC);
CREATE INDEX idx_orders_delivery_created ON public.orders(delivery_status, created_at DESC, id DESC);
CREATE INDEX idx_orders_confirm_delivery_created ON public.orders(confirmation_status, delivery_status, created_at DESC, id DESC);
CREATE INDEX idx_orders_seller_confirm_created ON public.orders(seller_id, confirmation_status, created_at DESC, id DESC);
CREATE INDEX idx_orders_seller_delivery_created ON public.orders(seller_id, delivery_status, created_at DESC, id DESC);
CREATE INDEX idx_orders_fulfillment_created ON public.orders(fulfillment_status, created_at DESC, id DESC);
CREATE INDEX idx_orders_invoice_created ON public.orders(invoice_id, created_at DESC) WHERE invoice_id IS NOT NULL;
CREATE INDEX idx_orders_confirmed_at ON public.orders(confirmed_at DESC) WHERE confirmed_at IS NOT NULL;
CREATE INDEX idx_orders_delivered_at ON public.orders(delivered_at DESC) WHERE delivered_at IS NOT NULL;
CREATE INDEX idx_orders_agent_queue ON public.orders(confirmation_status, created_at ASC, id ASC) WHERE agent_id IS NULL;
CREATE INDEX idx_orders_agent_lock_timeout ON public.orders(last_activity_at) WHERE agent_id IS NOT NULL AND confirmation_status IN ('new','no_answer','postponed');
CREATE INDEX idx_orders_follow_up_queue ON public.orders(follow_up_assigned_to, shipped_at DESC, id DESC) WHERE follow_up_assigned_to IS NOT NULL;
CREATE INDEX idx_orders_city_created ON public.orders(customer_city, created_at DESC);
CREATE INDEX idx_orders_system_id ON public.orders(system_id);
CREATE INDEX idx_orders_agent_created ON public.orders(agent_id, created_at DESC) WHERE agent_id IS NOT NULL;
CREATE INDEX idx_orders_phone_normalized ON public.orders(customer_phone_normalized);
CREATE INDEX idx_orders_order_id_trgm ON public.orders USING gin (order_id gin_trgm_ops);
CREATE INDEX idx_orders_customer_name_trgm ON public.orders USING gin (customer_name gin_trgm_ops);
CREATE INDEX idx_orders_customer_phone_trgm ON public.orders USING gin (customer_phone gin_trgm_ops);
CREATE INDEX idx_order_items_order ON public.order_items(order_id);
CREATE INDEX idx_order_items_variant ON public.order_items(product_variant_id);
CREATE INDEX idx_order_items_product_order ON public.order_items(product_id, order_id);
CREATE INDEX idx_order_history_order_created ON public.order_history(order_id, created_at DESC);
CREATE INDEX idx_order_history_field_value_created ON public.order_history(field_changed, new_value, created_at DESC);
CREATE INDEX idx_order_status_events_order_created ON public.order_status_events(order_uuid, created_at DESC);
CREATE INDEX idx_order_follow_ups_status ON public.order_follow_ups(follow_up_status, updated_at DESC);
CREATE INDEX idx_order_follow_ups_updated ON public.order_follow_ups(updated_at DESC);
CREATE INDEX idx_calls_agent_created ON public.calls(agent_id, created_at DESC);
CREATE INDEX idx_calls_order_created ON public.calls(order_id, created_at DESC);
CREATE INDEX idx_agent_activity_agent_created ON public.agent_activity_log(agent_id, created_at DESC);
CREATE INDEX idx_integration_sheets_seller ON public.integration_sheets(seller_id);
CREATE INDEX idx_integration_errors_sheet_created ON public.integration_errors(sheet_id, created_at DESC);
CREATE INDEX idx_carriers_enabled_priority ON public.carriers(enabled, priority, code);
CREATE INDEX idx_carrier_city_cache_name_trgm ON public.carrier_city_cache USING gin (city_name gin_trgm_ops);
CREATE INDEX idx_shipping_rules_active_priority ON public.shipping_rules(enabled, priority);
CREATE INDEX idx_shipments_order_created ON public.shipments(order_uuid, created_at DESC);
CREATE INDEX idx_shipments_carrier_created ON public.shipments(carrier_id, created_at DESC);
CREATE INDEX idx_shipments_order_id ON public.shipments(order_id);
CREATE INDEX idx_shipments_carrier_status_created ON public.shipments(carrier_id, normalized_status, created_at DESC);
CREATE INDEX idx_shipments_tracking_trgm ON public.shipments USING gin (tracking_number gin_trgm_ops);
CREATE UNIQUE INDEX idx_shipments_tracking_unique ON public.shipments(tracking_number) WHERE tracking_number IS NOT NULL;
CREATE INDEX idx_shipments_sync_created ON public.shipments(sync_status, created_at DESC);
CREATE INDEX idx_shipments_status_synced ON public.shipments(normalized_status, last_synced_at);
CREATE INDEX idx_shipments_sync_retry ON public.shipments(sync_status, last_synced_at, created_at) WHERE sync_status IN ('pending','failed');
CREATE INDEX idx_shipment_events_shipment_created ON public.shipment_events(shipment_id, created_at DESC);
CREATE INDEX idx_shipment_labels_shipment_created ON public.shipment_labels(shipment_id, created_at DESC);
CREATE INDEX idx_shipment_payments_shipment_created ON public.shipment_payments(shipment_id, created_at DESC);
CREATE INDEX idx_fulfillment_batches_status_created ON public.fulfillment_batches(status, created_at DESC);
CREATE INDEX idx_fulfillment_items_status_created ON public.fulfillment_items(status, created_at DESC, id DESC);
CREATE INDEX idx_fulfillment_items_shipment ON public.fulfillment_items(shipment_id);
CREATE INDEX idx_fulfillment_items_order ON public.fulfillment_items(order_uuid);
CREATE INDEX idx_scan_events_tracking_scanned ON public.scan_events(tracking_number, scanned_at DESC);
CREATE INDEX idx_scan_events_type_scanned ON public.scan_events(scan_type, scanned_at DESC);
CREATE INDEX idx_inventory_balances_variant_location ON public.inventory_balances(product_variant_id, location_id);
CREATE INDEX idx_inventory_balances_location ON public.inventory_balances(location_id, product_variant_id);
CREATE INDEX idx_inventory_movements_variant_created ON public.inventory_movements(product_variant_id, created_at DESC);
CREATE INDEX idx_inventory_movements_order_created ON public.inventory_movements(order_uuid, created_at DESC);
CREATE INDEX idx_inventory_movements_shipment_created ON public.inventory_movements(shipment_id, created_at DESC);
CREATE INDEX idx_return_receipts_status_received ON public.return_receipts(status, received_at DESC);
CREATE INDEX idx_return_receipts_shipment ON public.return_receipts(shipment_id);
CREATE INDEX idx_whatsapp_conversations_status_last ON public.whatsapp_conversations(status, last_message_at DESC);
CREATE INDEX idx_whatsapp_conversations_phone ON public.whatsapp_conversations(customer_phone_normalized);
CREATE INDEX idx_whatsapp_conversations_order ON public.whatsapp_conversations(order_id);
CREATE INDEX idx_whatsapp_messages_conversation_created ON public.whatsapp_messages(conversation_id, created_at DESC);
CREATE INDEX idx_whatsapp_messages_order_created ON public.whatsapp_messages(order_id, created_at DESC);
CREATE INDEX idx_whatsapp_messages_direction_created ON public.whatsapp_messages(direction, created_at DESC);
CREATE UNIQUE INDEX whatsapp_messages_meta_message_id_unique ON public.whatsapp_messages(meta_message_id) WHERE meta_message_id IS NOT NULL;
CREATE INDEX idx_whatsapp_automations_status ON public.whatsapp_automations(status);
CREATE INDEX idx_whatsapp_automations_trigger ON public.whatsapp_automations(trigger_type);
CREATE INDEX idx_automation_runs_automation ON public.whatsapp_automation_runs(automation_id, started_at DESC);
CREATE INDEX idx_automation_runs_status ON public.whatsapp_automation_runs(status);
CREATE INDEX whatsapp_automation_runs_status_wait_idx ON public.whatsapp_automation_runs(status, wait_until);
CREATE INDEX idx_wts_campaigns_status ON public.whatsapp_campaigns(status);
CREATE INDEX idx_wts_campaigns_scheduled ON public.whatsapp_campaigns(scheduled_at) WHERE status = 'scheduled';
CREATE INDEX idx_wts_camp_recip_campaign ON public.whatsapp_campaign_recipients(campaign_id);
CREATE INDEX idx_wts_camp_recip_status ON public.whatsapp_campaign_recipients(campaign_id, status);
CREATE INDEX idx_ai_memory_phone ON public.whatsapp_ai_memory(customer_phone);
CREATE INDEX idx_ai_suggestions_conv ON public.whatsapp_ai_suggestions(conversation_id, created_at DESC);
CREATE INDEX idx_sourcing_requests_seller_created ON public.sourcing_requests(seller_id, created_at DESC);
CREATE INDEX idx_sourcing_requests_status_created ON public.sourcing_requests(status, created_at DESC);
CREATE INDEX idx_support_tickets_seller_status ON public.support_tickets(seller_id, status);
CREATE INDEX idx_support_tickets_status_created ON public.support_tickets(status, created_at DESC);
CREATE INDEX idx_support_messages_ticket_created ON public.support_messages(ticket_id, created_at DESC);
CREATE INDEX idx_invoices_seller_status_created ON public.invoices(seller_id, status, created_at DESC);
CREATE INDEX idx_invoice_items_invoice ON public.invoice_items(invoice_id);
CREATE INDEX idx_invoice_adjustments_applied_invoice ON public.invoice_adjustments(applied_invoice_id, created_at DESC);
CREATE INDEX idx_invoice_addons_invoice ON public.invoice_addons(invoice_id, created_at DESC);
CREATE INDEX idx_daily_metrics_seller_date ON public.daily_order_metrics(seller_id, metric_date);
CREATE INDEX idx_daily_metrics_carrier_date ON public.daily_order_metrics(carrier_id, metric_date);
CREATE INDEX idx_daily_metrics_date ON public.daily_order_metrics(metric_date);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles','products','product_variants','sourcing_requests','orders',
    'order_follow_ups','integration_sheets','carriers','carrier_accounts',
    'carrier_pickup_addresses','shipping_rules','shipments','shipment_labels',
    'shipment_payments','fulfillment_batches','fulfillment_items',
    'inventory_locations','whatsapp_settings','whatsapp_templates',
    'whatsapp_conversations','whatsapp_automations','whatsapp_campaigns',
    'whatsapp_ai_settings','whatsapp_ai_memory','rate_settings',
    'seller_payment_methods','invoices','invoice_adjustments','support_tickets',
    'user_presence'
  ]
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t || '_set_updated_at', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()))', 'Staff manage ' || t, t);
  END LOOP;
END $$;

CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users view own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users view own permissions" ON public.user_permissions FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "Sellers view own orders" ON public.orders FOR SELECT TO authenticated USING (seller_id = auth.uid());
CREATE POLICY "Sellers manage own products" ON public.products FOR ALL TO authenticated USING (seller_id = auth.uid()) WITH CHECK (seller_id = auth.uid());
CREATE POLICY "Sellers view own order items" ON public.order_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = public.order_items.order_id AND o.seller_id = auth.uid()));
CREATE POLICY "Authenticated read permissions" ON public.permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read public app_settings" ON public.app_settings FOR SELECT TO authenticated USING (is_public OR public.is_staff(auth.uid()));

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
GRANT SELECT ON public.order_list_view TO authenticated, service_role;
GRANT SELECT ON public.fulfillment_queue_view TO authenticated, service_role;
GRANT SELECT ON public.inventory_balance_view TO authenticated, service_role;
GRANT SELECT ON public.returns_queue_view TO authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Seed
-- ---------------------------------------------------------------------------

INSERT INTO public.inventory_locations (code, name, type)
VALUES
  ('MAIN', 'Main Warehouse', 'sellable'),
  ('RETURNS', 'Returns / Inspection', 'returns'),
  ('DAMAGED', 'Damaged Stock', 'damaged')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.carriers (
  code, name, enabled, fulfillment_mode, supports_cod, supports_tracking,
  supports_bulk_tracking, supports_labels, supports_load_sheet, supports_cancel,
  supports_payment_status, priority
)
VALUES
  ('postex', 'PostEx', true, 'self_fulfilled', true, true, true, true, true, true, true, 100),
  ('orio', 'ORIO', false, 'carrier_managed', true, true, false, false, false, false, false, 10)
ON CONFLICT (code) DO NOTHING;

UPDATE public.carriers
SET enabled = true,
    fulfillment_mode = 'self_fulfilled',
    supports_cod = true,
    supports_tracking = true,
    supports_labels = true,
    supports_load_sheet = true,
    supports_cancel = true,
    supports_payment_status = true,
    priority = 100
WHERE code = 'postex';

UPDATE public.carriers
SET enabled = false,
    priority = 10
WHERE code = 'orio';

INSERT INTO public.whatsapp_settings (singleton) VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

INSERT INTO public.whatsapp_ai_settings (singleton) VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

INSERT INTO public.app_settings (key, value, is_public, updated_at)
VALUES ('project_url', 'https://miyzjhjcyowkttdszxit.supabase.co', true, now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, is_public = EXCLUDED.is_public, updated_at = now();

INSERT INTO public.permissions (key, label, category)
VALUES
  ('access_to_dashboard', 'Access dashboard', 'dashboard'),
  ('view_dashboard', 'View dashboard', 'dashboard'),
  ('access_to_orders', 'Access orders', 'orders'),
  ('view_order', 'View orders', 'orders'),
  ('create_order', 'Create orders', 'orders'),
  ('update_order', 'Update orders', 'orders'),
  ('show_all_orders', 'Show all orders', 'orders'),
  ('access_to_products', 'Access products', 'products'),
  ('view_product', 'View products', 'products'),
  ('create_product', 'Create products', 'products'),
  ('update_product', 'Update products', 'products'),
  ('show_all_products', 'Show all products', 'products'),
  ('access_to_confirmations', 'Access confirmations', 'confirmations'),
  ('view_confirmation', 'View confirmations', 'confirmations'),
  ('create_confirmation', 'Create confirmations', 'confirmations'),
  ('update_confirmation', 'Update confirmations', 'confirmations'),
  ('show_all_confirmations', 'Show all confirmations', 'confirmations'),
  ('access_to_whatsapp', 'Access WhatsApp', 'whatsapp'),
  ('manage_whatsapp', 'Manage WhatsApp', 'whatsapp'),
  ('access_to_fulfillment', 'Access fulfillment', 'fulfillment'),
  ('scan_shipments', 'Scan shipments', 'fulfillment'),
  ('manage_inventory', 'Manage inventory', 'inventory')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.whatsapp_conversations REPLICA IDENTITY FULL;
ALTER TABLE public.whatsapp_messages REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_conversations;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

NOTIFY pgrst, 'reload schema';
