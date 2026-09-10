-- Auto-upsell flag: when a confirmation agent increases an order's quantity
-- during confirmation (e.g. 1 → 2, 2 → 3), the order is marked as an upsell.
-- Surfaced by the "Upsell" filter on the Orders page (which until now was a
-- dead filter — every order was hard-coded to upsell=false client-side).

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS is_upsell boolean NOT NULL DEFAULT false;

-- Selective: the "Yes" filter is the one that matters; most orders are false.
CREATE INDEX IF NOT EXISTS idx_orders_is_upsell
  ON public.orders (is_upsell) WHERE is_upsell;

-- agent_submit_order gains a p_is_upsell param. It's applied stickily
-- (`p_is_upsell OR is_upsell`) — an upsell that happened stays recorded even
-- if a later retry edits the quantity back down. DROP + CREATE because adding
-- a parameter changes the signature (CREATE OR REPLACE would leave the old
-- 26-arg overload in place and make calls ambiguous).
DROP FUNCTION IF EXISTS public.agent_submit_order(
  uuid, text, uuid, timestamptz, timestamptz, text, text, text, text, text,
  integer, numeric, numeric, boolean, text, integer, uuid, timestamptz,
  integer, date, timestamptz, text, timestamptz, text, text, text
);

CREATE FUNCTION public.agent_submit_order(
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
  p_original_agent_id uuid DEFAULT NULL::uuid,
  p_last_attempt_at timestamptz DEFAULT NULL::timestamptz,
  p_attempts_today integer DEFAULT NULL::integer,
  p_last_attempt_date date DEFAULT NULL::date,
  p_postpone_date timestamptz DEFAULT NULL::timestamptz,
  p_postpone_note text DEFAULT NULL::text,
  p_confirmed_at timestamptz DEFAULT NULL::timestamptz,
  p_delivery_status text DEFAULT NULL::text,
  p_cancel_reason text DEFAULT NULL::text,
  p_confirmation_channel text DEFAULT NULL::text,
  p_is_upsell boolean DEFAULT NULL::boolean
)
RETURNS SETOF public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  UPDATE public.orders
  SET confirmation_status = p_confirmation_status,
      confirmation_channel = COALESCE(p_confirmation_channel, confirmation_channel),
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
      is_upsell = (COALESCE(p_is_upsell, false) OR is_upsell),
      note = p_note,
      attempt_count = p_attempt_count,
      original_agent_id = COALESCE(p_original_agent_id, original_agent_id),
      last_attempt_at = COALESCE(p_last_attempt_at, last_attempt_at),
      attempts_today = COALESCE(p_attempts_today, attempts_today),
      last_attempt_date = COALESCE(p_last_attempt_date, last_attempt_date),
      postpone_date = COALESCE(p_postpone_date, postpone_date),
      postpone_note = COALESCE(p_postpone_note, postpone_note),
      confirmed_at = COALESCE(p_confirmed_at, confirmed_at),
      delivery_status = CASE
        WHEN p_delivery_status IS NULL THEN delivery_status
        WHEN p_delivery_status IN ('pending', 'booked')
          AND delivery_status IN ('printed', 'dispatched', 'shipped', 'in_transit', 'with_courier', 'out_for_delivery', 'delivered', 'paid', 'returned', 'return_received')
          THEN delivery_status
        ELSE p_delivery_status
      END,
      cancel_reason = COALESCE(p_cancel_reason, cancel_reason),
      updated_at = now()
  WHERE id = p_order_id
    AND agent_id = auth.uid()
    AND confirmation_status IN ('new', 'no_answer', 'postponed')
  RETURNING *;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.agent_submit_order(
  uuid, text, uuid, timestamptz, timestamptz, text, text, text, text, text,
  integer, numeric, numeric, boolean, text, integer, uuid, timestamptz,
  integer, date, timestamptz, text, timestamptz, text, text, text, boolean
) TO anon, authenticated, service_role;
