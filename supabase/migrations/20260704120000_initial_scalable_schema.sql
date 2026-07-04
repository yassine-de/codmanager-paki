-- Initial scalable schema for multi-carrier COD, fulfillment, inventory and analytics.
-- Designed for a fresh Supabase database.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

CREATE TYPE public.app_role AS ENUM (
  'admin',
  'seller',
  'agent',
  'follow_up',
  'warehouse_agent',
  'warehouse_manager'
);

CREATE TYPE public.order_confirmation_status AS ENUM (
  'new',
  'assigned',
  'confirmed',
  'no_answer',
  'unreachable',
  'postponed',
  'cancelled',
  'double',
  'wrong_number'
);

CREATE TYPE public.delivery_status AS ENUM (
  'pending',
  'booked',
  'label_ready',
  'shipped',
  'in_transit',
  'out_for_delivery',
  'failed_attempt',
  'delivered',
  'ready_for_return',
  'return_in_transit',
  'return_received',
  'returned',
  'cancelled'
);

CREATE TYPE public.fulfillment_status AS ENUM (
  'not_required',
  'pending',
  'label_ready',
  'packing',
  'packed',
  'scanned',
  'ready_for_pickup',
  'picked_up',
  'closed',
  'return_received',
  'return_inspection',
  'restocked',
  'damaged_return',
  'missing_return'
);

CREATE TYPE public.payment_status AS ENUM (
  'unpaid',
  'cod_pending',
  'settled',
  'partially_settled',
  'refunded',
  'cancelled'
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

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

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
-- Identity, roles and sellers
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

CREATE TABLE public.seller_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  store_name text,
  store_url text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Products and orders
-- ---------------------------------------------------------------------------

CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES auth.users(id),
  sku text NOT NULL,
  name text NOT NULL,
  description text,
  product_url text,
  image_url text,
  video_url text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (seller_id, sku)
);

CREATE TABLE public.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sku text NOT NULL,
  name text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  price numeric(12,2) NOT NULL DEFAULT 0,
  landed_cost numeric(12,2),
  weight_kg numeric(10,3),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sku)
);

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  system_number bigint GENERATED BY DEFAULT AS IDENTITY UNIQUE,
  seller_id uuid NOT NULL REFERENCES auth.users(id),
  source text NOT NULL DEFAULT 'manual',
  source_ref text,
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  customer_phone_normalized text GENERATED ALWAYS AS (public.normalize_phone_key(customer_phone)) STORED,
  customer_city text NOT NULL,
  customer_address text,
  confirmation_status public.order_confirmation_status NOT NULL DEFAULT 'new',
  delivery_status public.delivery_status NOT NULL DEFAULT 'pending',
  fulfillment_status public.fulfillment_status NOT NULL DEFAULT 'pending',
  payment_status public.payment_status NOT NULL DEFAULT 'cod_pending',
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'PKR',
  agent_id uuid REFERENCES auth.users(id),
  original_agent_id uuid REFERENCES auth.users(id),
  assigned_at timestamptz,
  confirmed_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  last_activity_at timestamptz,
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

CREATE TABLE public.order_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  old_value text,
  new_value text,
  note text,
  actor_id uuid REFERENCES auth.users(id),
  actor_role public.app_role,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Carriers and shipping
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
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  carrier_id uuid NOT NULL REFERENCES public.carriers(id),
  carrier_account_id uuid REFERENCES public.carrier_accounts(id),
  pickup_address_id uuid REFERENCES public.carrier_pickup_addresses(id),
  carrier_order_id text,
  tracking_number text,
  carrier_reference text,
  carrier_status text,
  normalized_status public.delivery_status NOT NULL DEFAULT 'booked',
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
  normalized_status public.delivery_status,
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
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  settled boolean NOT NULL DEFAULT false,
  settlement_date date,
  upfront_payment_date date,
  reserve_payment_date date,
  cpr_number_1 text,
  cpr_number_2 text,
  raw_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shipment_id)
);

-- ---------------------------------------------------------------------------
-- Fulfillment, scans and inventory
-- ---------------------------------------------------------------------------

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
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  status public.fulfillment_item_status NOT NULL DEFAULT 'pending',
  picked_at timestamptz,
  packed_at timestamptz,
  label_printed_at timestamptz,
  scanned_at timestamptz,
  packed_by uuid REFERENCES auth.users(id),
  scanned_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shipment_id)
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
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
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
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  scan_event_id uuid REFERENCES public.scan_events(id),
  condition public.return_condition NOT NULL,
  status public.fulfillment_status NOT NULL DEFAULT 'return_received',
  received_by uuid REFERENCES auth.users(id),
  received_at timestamptz NOT NULL DEFAULT now(),
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (shipment_id)
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
-- WhatsApp and finance
-- ---------------------------------------------------------------------------

CREATE TABLE public.whatsapp_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
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
  resolved_by uuid REFERENCES auth.users(id),
  resolved_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  direction text NOT NULL,
  message_type text NOT NULL DEFAULT 'text',
  body text,
  meta_message_id text UNIQUE,
  status text,
  error_message text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  seller_id uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'draft',
  period_start date NOT NULL,
  period_end date NOT NULL,
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  fees_total numeric(12,2) NOT NULL DEFAULT 0,
  adjustments_total numeric(12,2) NOT NULL DEFAULT 0,
  net_payable numeric(12,2) NOT NULL DEFAULT 0,
  finalized_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  shipment_id uuid REFERENCES public.shipments(id) ON DELETE SET NULL,
  description text NOT NULL,
  amount numeric(12,2) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.invoice_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES auth.users(id),
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  amount numeric(12,2) NOT NULL,
  reason text,
  created_by uuid REFERENCES auth.users(id),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Read models and daily metrics
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
  items.first_product_name,
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
  WHERE sh.order_id = o.id
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
  o.id AS order_id,
  o.order_number,
  o.system_number,
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
  fi.updated_at
FROM public.fulfillment_items fi
JOIN public.orders o ON o.id = fi.order_id
JOIN public.shipments sh ON sh.id = fi.shipment_id
JOIN public.carriers c ON c.id = sh.carrier_id
LEFT JOIN public.fulfillment_batches fb ON fb.id = fi.batch_id;

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
  o.id AS order_id,
  o.order_number,
  o.system_number,
  o.customer_name,
  sh.id AS shipment_id,
  sh.tracking_number,
  c.code AS carrier_code,
  c.name AS carrier_name
FROM public.return_receipts rr
JOIN public.orders o ON o.id = rr.order_id
JOIN public.shipments sh ON sh.id = rr.shipment_id
JOIN public.carriers c ON c.id = sh.carrier_id;

-- Cursor-pagination RPC. Uses created_at + id keyset pagination.
CREATE OR REPLACE FUNCTION public.get_orders_page(
  p_limit integer DEFAULT 50,
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_seller_id uuid DEFAULT NULL,
  p_confirmation_status public.order_confirmation_status DEFAULT NULL,
  p_delivery_status public.delivery_status DEFAULT NULL,
  p_fulfillment_status public.fulfillment_status DEFAULT NULL,
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
    COUNT(DISTINCT d.order_id) FILTER (WHERE d.created_on_metric_date)::integer,
    COUNT(DISTINCT d.order_id) FILTER (WHERE d.confirmed_on_metric_date)::integer,
    COUNT(DISTINCT d.order_id) FILTER (WHERE d.cancelled_on_metric_date)::integer,
    COUNT(DISTINCT d.shipment_id) FILTER (WHERE d.shipment_booked_on_metric_date)::integer,
    COUNT(DISTINCT d.shipment_id) FILTER (WHERE d.shipment_shipped_on_metric_date)::integer,
    COUNT(DISTINCT d.shipment_id) FILTER (WHERE d.shipment_delivered_on_metric_date)::integer,
    COUNT(DISTINCT d.shipment_id) FILTER (WHERE d.shipment_returned_on_metric_date)::integer,
    COALESCE(SUM(d.total_amount) FILTER (WHERE d.created_on_metric_date), 0),
    COALESCE(SUM(d.total_amount) FILTER (WHERE d.shipment_delivered_on_metric_date), 0)
  FROM (
    SELECT
      gs::date AS metric_date,
      o.id AS order_id,
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
    LEFT JOIN public.shipments sh ON sh.order_id = o.id
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
    m.metric_date,
    COALESCE(SUM(m.orders_created), 0)::integer,
    COALESCE(SUM(m.orders_confirmed), 0)::integer,
    COALESCE(SUM(m.orders_cancelled), 0)::integer,
    COALESCE(SUM(m.shipments_booked), 0)::integer,
    COALESCE(SUM(m.shipments_shipped), 0)::integer,
    COALESCE(SUM(m.shipments_delivered), 0)::integer,
    COALESCE(SUM(m.shipments_returned), 0)::integer,
    COALESCE(SUM(m.gross_revenue), 0),
    COALESCE(SUM(m.delivered_revenue), 0)
  FROM public.daily_order_metrics m
  WHERE m.metric_date BETWEEN p_from AND p_to
    AND (p_seller_id IS NULL OR m.seller_id = p_seller_id)
    AND (p_carrier_id IS NULL OR m.carrier_id = p_carrier_id)
  GROUP BY m.metric_date
  ORDER BY m.metric_date;
$$;

-- ---------------------------------------------------------------------------
-- Scan RPCs: idempotent stock movement at shipment scan time.
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

  SELECT id INTO v_main_location
  FROM public.inventory_locations
  WHERE code = 'MAIN'
  LIMIT 1;

  IF v_main_location IS NULL THEN
    RAISE EXCEPTION 'Inventory location MAIN is missing';
  END IF;

  INSERT INTO public.scan_events (shipment_id, tracking_number, scan_type, result, scanned_by)
  VALUES (v_shipment.id, p_tracking_number, 'outbound', 'ok', p_scanned_by)
  RETURNING id INTO v_scan_id;

  FOR v_item IN
    SELECT oi.product_variant_id, oi.quantity
    FROM public.order_items oi
    WHERE oi.order_id = v_shipment.order_id AND oi.product_variant_id IS NOT NULL
  LOOP
    INSERT INTO public.inventory_movements (
      product_variant_id, order_id, shipment_id, scan_event_id, movement_type,
      quantity_change, from_location_id, created_by
    )
    VALUES (
      v_item.product_variant_id, v_shipment.order_id, v_shipment.id, v_scan_id, 'ship',
      -v_item.quantity, v_main_location, p_scanned_by
    );

    INSERT INTO public.inventory_balances (product_variant_id, location_id, quantity_on_hand)
    VALUES (v_item.product_variant_id, v_main_location, -v_item.quantity)
    ON CONFLICT (product_variant_id, location_id)
    DO UPDATE SET
      quantity_on_hand = public.inventory_balances.quantity_on_hand - v_item.quantity,
      updated_at = now();
  END LOOP;

  UPDATE public.fulfillment_items
  SET status = 'scanned', scanned_at = now(), scanned_by = p_scanned_by, updated_at = now()
  WHERE shipment_id = v_shipment.id;

  UPDATE public.orders
  SET fulfillment_status = 'scanned', updated_at = now()
  WHERE id = v_shipment.order_id;

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

  SELECT COUNT(*) INTO v_existing
  FROM public.return_receipts
  WHERE shipment_id = v_shipment.id;

  IF v_existing > 0 THEN
    INSERT INTO public.scan_events (shipment_id, tracking_number, scan_type, result, message, scanned_by)
    VALUES (v_shipment.id, p_tracking_number, 'return', 'duplicate', 'Return already received', p_scanned_by)
    RETURNING id INTO v_scan_id;
    RETURN jsonb_build_object('ok', true, 'result', 'duplicate', 'shipment_id', v_shipment.id, 'scan_event_id', v_scan_id);
  END IF;

  SELECT id INTO v_location
  FROM public.inventory_locations
  WHERE code = CASE
    WHEN p_condition = 'sellable' THEN 'MAIN'
    WHEN p_condition = 'damaged' THEN 'DAMAGED'
    ELSE 'RETURNS'
  END
  LIMIT 1;

  IF v_location IS NULL THEN
    RAISE EXCEPTION 'Required return inventory location is missing';
  END IF;

  INSERT INTO public.scan_events (shipment_id, tracking_number, scan_type, result, scanned_by)
  VALUES (v_shipment.id, p_tracking_number, 'return', 'ok', p_scanned_by)
  RETURNING id INTO v_scan_id;

  INSERT INTO public.return_receipts (shipment_id, order_id, scan_event_id, condition, received_by, note)
  VALUES (v_shipment.id, v_shipment.order_id, v_scan_id, p_condition, p_scanned_by, p_note)
  RETURNING id INTO v_receipt_id;

  FOR v_item IN
    SELECT oi.id AS order_item_id, oi.product_variant_id, oi.quantity
    FROM public.order_items oi
    WHERE oi.order_id = v_shipment.order_id AND oi.product_variant_id IS NOT NULL
  LOOP
    INSERT INTO public.return_receipt_items (
      return_receipt_id, order_item_id, product_variant_id,
      expected_quantity, received_quantity, condition
    )
    VALUES (v_receipt_id, v_item.order_item_id, v_item.product_variant_id, v_item.quantity, v_item.quantity, p_condition);

    INSERT INTO public.inventory_movements (
      product_variant_id, order_id, shipment_id, scan_event_id, movement_type,
      quantity_change, to_location_id, created_by
    )
    VALUES (
      v_item.product_variant_id, v_shipment.order_id, v_shipment.id, v_scan_id,
      CASE WHEN p_condition = 'sellable' THEN 'restock' ELSE 'return_received' END,
      v_item.quantity, v_location, p_scanned_by
    );

    INSERT INTO public.inventory_balances (product_variant_id, location_id, quantity_on_hand)
    VALUES (v_item.product_variant_id, v_location, v_item.quantity)
    ON CONFLICT (product_variant_id, location_id)
    DO UPDATE SET
      quantity_on_hand = public.inventory_balances.quantity_on_hand + v_item.quantity,
      updated_at = now();
  END LOOP;

  UPDATE public.shipments
  SET normalized_status = 'return_received', updated_at = now()
  WHERE id = v_shipment.id;

  UPDATE public.orders
  SET delivery_status = 'return_received',
      fulfillment_status = CASE
        WHEN p_condition = 'sellable' THEN 'restocked'::public.fulfillment_status
        WHEN p_condition = 'damaged' THEN 'damaged_return'::public.fulfillment_status
        WHEN p_condition = 'missing_item' THEN 'missing_return'::public.fulfillment_status
        ELSE 'return_inspection'::public.fulfillment_status
      END,
      updated_at = now()
  WHERE id = v_shipment.order_id;

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
CREATE INDEX idx_orders_fulfillment_created ON public.orders(fulfillment_status, created_at DESC, id DESC);
CREATE INDEX idx_orders_agent_created ON public.orders(agent_id, created_at DESC) WHERE agent_id IS NOT NULL;
CREATE INDEX idx_orders_phone_normalized ON public.orders(customer_phone_normalized);
CREATE INDEX idx_orders_customer_name_trgm ON public.orders USING gin (customer_name gin_trgm_ops);
CREATE INDEX idx_orders_city_created ON public.orders(customer_city, created_at DESC);

CREATE INDEX idx_order_items_order ON public.order_items(order_id);
CREATE INDEX idx_order_items_variant ON public.order_items(product_variant_id);
CREATE INDEX idx_order_status_events_order_created ON public.order_status_events(order_id, created_at DESC);
CREATE INDEX idx_order_status_events_type_created ON public.order_status_events(event_type, created_at DESC);

CREATE UNIQUE INDEX idx_carrier_city_cache_carrier_city ON public.carrier_city_cache(carrier_id, lower(city_name));
CREATE INDEX idx_shipping_rules_enabled_priority ON public.shipping_rules(enabled, priority);

CREATE INDEX idx_shipments_order_created ON public.shipments(order_id, created_at DESC);
CREATE INDEX idx_shipments_carrier_created ON public.shipments(carrier_id, created_at DESC);
CREATE UNIQUE INDEX idx_shipments_tracking_unique ON public.shipments(tracking_number) WHERE tracking_number IS NOT NULL;
CREATE INDEX idx_shipments_sync_created ON public.shipments(sync_status, created_at DESC);
CREATE INDEX idx_shipments_status_synced ON public.shipments(normalized_status, last_synced_at);
CREATE INDEX idx_shipment_events_shipment_occurred ON public.shipment_events(shipment_id, occurred_at DESC);

CREATE INDEX idx_fulfillment_batches_carrier_status_created ON public.fulfillment_batches(carrier_id, status, created_at DESC);
CREATE INDEX idx_fulfillment_items_status_created ON public.fulfillment_items(status, created_at DESC, id DESC);
CREATE INDEX idx_fulfillment_items_batch_status ON public.fulfillment_items(batch_id, status);
CREATE INDEX idx_fulfillment_items_order ON public.fulfillment_items(order_id);

CREATE INDEX idx_scan_events_tracking_scanned ON public.scan_events(tracking_number, scanned_at DESC);
CREATE INDEX idx_scan_events_shipment_type ON public.scan_events(shipment_id, scan_type);

CREATE INDEX idx_inventory_balances_variant_location ON public.inventory_balances(product_variant_id, location_id);
CREATE INDEX idx_inventory_movements_variant_created ON public.inventory_movements(product_variant_id, created_at DESC);
CREATE INDEX idx_inventory_movements_shipment ON public.inventory_movements(shipment_id);
CREATE INDEX idx_inventory_movements_type_created ON public.inventory_movements(movement_type, created_at DESC);

CREATE INDEX idx_return_receipts_status_received ON public.return_receipts(status, received_at DESC);

CREATE INDEX idx_whatsapp_conversations_status_last ON public.whatsapp_conversations(status, last_message_at DESC);
CREATE INDEX idx_whatsapp_conversations_phone ON public.whatsapp_conversations(customer_phone_normalized);
CREATE INDEX idx_whatsapp_conversations_order ON public.whatsapp_conversations(order_id);
CREATE INDEX idx_whatsapp_messages_conversation_created ON public.whatsapp_messages(conversation_id, created_at DESC);
CREATE INDEX idx_whatsapp_messages_order_created ON public.whatsapp_messages(order_id, created_at DESC);

CREATE INDEX idx_invoices_seller_period ON public.invoices(seller_id, period_start, period_end);
CREATE INDEX idx_invoice_items_invoice ON public.invoice_items(invoice_id);
CREATE INDEX idx_invoice_adjustments_seller_status ON public.invoice_adjustments(seller_id, status, created_at DESC);

CREATE INDEX idx_daily_metrics_date ON public.daily_order_metrics(metric_date);
CREATE INDEX idx_daily_metrics_seller_date ON public.daily_order_metrics(seller_id, metric_date);
CREATE INDEX idx_daily_metrics_carrier_date ON public.daily_order_metrics(carrier_id, metric_date);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles','seller_profiles','products','product_variants','orders',
    'carriers','carrier_accounts','carrier_pickup_addresses','shipping_rules',
    'shipments','shipment_labels','shipment_payments',
    'fulfillment_batches','fulfillment_items','inventory_locations',
    'whatsapp_conversations','invoices','invoice_adjustments'
  ]
  LOOP
    EXECUTE format('CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Seed essential rows
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
  ('orio', 'ORIO', true, 'carrier_managed', true, true, false, false, false, false, false, 100),
  ('postex', 'PostEx', true, 'self_fulfilled', true, true, true, true, true, true, true, 90)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carriers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carrier_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carrier_city_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carrier_pickup_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipping_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fulfillment_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fulfillment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_order_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access profiles" ON public.profiles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users view own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Staff view operational tables" ON public.carriers FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "Admins manage carriers" ON public.carriers FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Broad but role-bounded operational policies for initial app build. Tighten per screen once UI is wired.
CREATE POLICY "Staff manage operations orders" ON public.orders FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "Sellers view own orders" ON public.orders FOR SELECT TO authenticated USING (seller_id = auth.uid());

CREATE POLICY "Staff manage order items" ON public.order_items FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "Sellers view own order items" ON public.order_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND o.seller_id = auth.uid()));

CREATE POLICY "Staff manage products" ON public.products FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "Sellers manage own products" ON public.products FOR ALL TO authenticated USING (seller_id = auth.uid()) WITH CHECK (seller_id = auth.uid());

CREATE POLICY "Staff manage product variants" ON public.product_variants FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "Sellers view own product variants" ON public.product_variants FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_id AND p.seller_id = auth.uid()));

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'seller_profiles','order_status_events','carrier_accounts','carrier_city_cache',
    'carrier_pickup_addresses','shipping_rules','shipments','shipment_events',
    'shipment_labels','shipment_payments','fulfillment_batches','fulfillment_items',
    'inventory_locations','inventory_balances','scan_events','inventory_movements',
    'return_receipts','return_receipt_items','whatsapp_conversations','whatsapp_messages',
    'invoices','invoice_items','invoice_adjustments','daily_order_metrics'
  ]
  LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()))', 'Staff manage ' || t, t);
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON public.order_list_view TO authenticated, service_role;
GRANT SELECT ON public.fulfillment_queue_view TO authenticated, service_role;
GRANT SELECT ON public.inventory_balance_view TO authenticated, service_role;
GRANT SELECT ON public.returns_queue_view TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_orders_page(integer, timestamptz, uuid, uuid, public.order_confirmation_status, public.delivery_status, public.fulfillment_status, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_fulfillment_queue(integer, timestamptz, uuid, uuid, public.fulfillment_item_status) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_dashboard_metrics(date, date, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_daily_order_metrics(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.scan_outbound_shipment(text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.scan_return_shipment(text, public.return_condition, uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
