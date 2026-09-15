-- Bug: when an agent changes the product/price while confirming an order,
-- agent_submit_order() updates orders.product_name/price/quantity/total_amount
-- but never touches order_items — so any consumer that prefers order_items
-- over the flat columns (courier label generation in shipping-sync/
-- mnp-shipping-sync's buildOrderDetail(), WhatsappInbox.tsx's
-- getOrderItems(), Orders.tsx's mapOrderProducts()) keeps showing the
-- ORIGINAL product. Confirmed live on AB-4264: orders.product_name correctly
-- became "GEDI Luxury" but order_items still had "Cable type C" — and the
-- physical PostEx label that got printed showed "Cable type C x 1", the
-- stale value.
--
-- Fix: after updating orders, also update order_items to match — but ONLY
-- when the order has exactly one item row (5,350 of 5,373 orders with any
-- items today). A genuine multi-product order's items are a different
-- shape than this RPC's single p_product_name/p_price/p_quantity params,
-- so overwriting all of them with one value would be wrong; those orders
-- are left untouched here (pre-existing limitation of this confirm flow,
-- not introduced by this fix).
CREATE OR REPLACE FUNCTION public.agent_submit_order(p_order_id uuid, p_confirmation_status text, p_agent_id uuid, p_assigned_at timestamp with time zone, p_last_activity_at timestamp with time zone, p_customer_name text, p_customer_phone text, p_customer_city text, p_customer_address text, p_product_name text, p_quantity integer, p_price numeric, p_total_amount numeric, p_is_manual_price boolean, p_note text, p_attempt_count integer, p_original_agent_id uuid DEFAULT NULL::uuid, p_last_attempt_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_attempts_today integer DEFAULT NULL::integer, p_last_attempt_date date DEFAULT NULL::date, p_postpone_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_postpone_note text DEFAULT NULL::text, p_confirmed_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_delivery_status text DEFAULT NULL::text, p_cancel_reason text DEFAULT NULL::text, p_confirmation_channel text DEFAULT NULL::text, p_is_upsell boolean DEFAULT NULL::boolean)
 RETURNS SETOF orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
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
    AND confirmation_status IN ('new', 'no_answer', 'postponed');

  -- Only sync order_items when the orders row above actually changed (so a
  -- rejected/raced submit — order already claimed/decided by someone else —
  -- never touches order_items), and only for the common single-item case.
  IF FOUND THEN
    -- total_price is a generated column (quantity * unit_price) — do not set it directly.
    UPDATE public.order_items
    SET product_name = p_product_name,
        quantity = p_quantity,
        unit_price = p_price
    WHERE order_id = p_order_id
      AND (SELECT count(*) FROM public.order_items WHERE order_id = p_order_id) = 1;
  END IF;

  RETURN QUERY SELECT * FROM public.orders WHERE id = p_order_id;
END;
$function$;
