
CREATE OR REPLACE FUNCTION public.get_invoice_summary(p_invoice_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_seller_rates public.seller_rates%ROWTYPE;
  v_confirmed_rate numeric := 0;
  v_dropped_rate numeric := 0;
  v_cod_fee_percentage numeric := 0;
  v_previous_balance numeric := 0;
  v_total_orders_count integer := 0;
  v_delivered_count integer := 0;
  v_shipped_count integer := 0;
  v_confirmed_count integer := 0;
  v_dropped_count integer := 0;
  v_all_period_count integer := 0;
  v_period_confirmed_count integer := 0;
  v_invoice_confirmed_count integer := 0;
  v_delivered_revenue_usd numeric := 0;
  v_shipping_fees numeric := 0;
  v_call_center_fees numeric := 0;
  v_cod_fees numeric := 0;
  v_addon_net numeric := 0;
  v_adjustment_net numeric := 0;
  v_net_payable numeric := 0;
  v_delivered_orders jsonb := '[]'::jsonb;
  v_all_orders jsonb := '[]'::jsonb;
  v_shipping_breakdown jsonb := '[]'::jsonb;
  v_addons jsonb := '[]'::jsonb;
  v_adjustments jsonb := '[]'::jsonb;
  v_period_start timestamptz;
  v_period_end timestamptz;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF auth.uid() <> v_invoice.seller_id AND NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;

  v_previous_balance := COALESCE(v_invoice.previous_balance, 0);
  v_period_start := v_invoice.created_at;
  v_period_end := COALESCE(v_invoice.finalized_at, now());

  SELECT * INTO v_seller_rates FROM public.seller_rates WHERE user_id = v_invoice.seller_id LIMIT 1;

  SELECT COALESCE(rs.confirmed_order_rate, 0), COALESCE(rs.dropped_order_rate, 0), COALESCE(rs.cod_fee_per_delivery, 0)
  INTO v_confirmed_rate, v_dropped_rate, v_cod_fee_percentage
  FROM public.rate_settings rs WHERE rs.seller_id = v_invoice.seller_id ORDER BY rs.updated_at DESC LIMIT 1;

  IF NOT FOUND THEN
    SELECT COALESCE(rs.confirmed_order_rate, 0), COALESCE(rs.dropped_order_rate, 0), COALESCE(rs.cod_fee_per_delivery, 0)
    INTO v_confirmed_rate, v_dropped_rate, v_cod_fee_percentage
    FROM public.rate_settings rs WHERE rs.seller_id IS NULL AND rs.is_global = true ORDER BY rs.updated_at DESC LIMIT 1;
  END IF;

  SELECT COUNT(*)::integer
  INTO v_all_period_count
  FROM public.orders
  WHERE seller_id = v_invoice.seller_id
    AND created_at >= v_period_start
    AND created_at <= v_period_end;

  v_dropped_count := v_all_period_count;

  SELECT COUNT(*)::integer
  INTO v_invoice_confirmed_count
  FROM public.orders
  WHERE invoice_id = p_invoice_id
    AND confirmation_status = 'confirmed';

  v_period_confirmed_count := v_invoice_confirmed_count;

  WITH invoice_orders AS (
    SELECT o.id, o.order_id, o.customer_name, o.customer_phone, o.product_name, o.quantity, o.price, o.total_amount, o.confirmation_status, o.delivery_status, o.created_at,
      COALESCE(p.weight_kg,
        CASE
          WHEN p.weight = 'up_to_1kg' THEN 0.5
          WHEN p.weight = 'up_to_2kg' THEN 1.5
          WHEN p.weight = 'up_to_3kg' THEN 2.5
          WHEN p.weight = 'above_3kg' THEN 3.5
          ELSE NULL
        END
      ) AS weight_kg,
      EXISTS (SELECT 1 FROM public.order_history oh WHERE oh.order_id = o.order_id AND oh.field_changed = 'delivery_status' AND oh.new_value = 'shipped') AS has_shipment_event
    FROM public.orders o
    LEFT JOIN public.products p ON p.seller_id = o.seller_id AND p.name = o.product_name
    WHERE o.invoice_id = p_invoice_id
  )
  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE delivery_status = 'delivered')::integer,
    COUNT(*) FILTER (WHERE has_shipment_event = true)::integer,
    COUNT(*) FILTER (WHERE confirmation_status = 'confirmed')::integer,
    COUNT(*) FILTER (WHERE confirmation_status IN ('cancelled', 'wrong_number', 'unreachable'))::integer,
    COALESCE(SUM((price * quantity) / 290.0) FILTER (WHERE delivery_status = 'delivered'), 0)::numeric
  INTO v_total_orders_count, v_delivered_count, v_shipped_count, v_confirmed_count, v_dropped_count, v_delivered_revenue_usd
  FROM invoice_orders;

  -- Delivered orders (for revenue calculation display)
  WITH invoice_orders AS (
    SELECT o.id, o.order_id, o.customer_name, o.customer_phone, o.product_name, o.quantity, o.price, o.total_amount, o.created_at,
      COALESCE(p.weight_kg,
        CASE
          WHEN p.weight = 'up_to_1kg' THEN 0.5
          WHEN p.weight = 'up_to_2kg' THEN 1.5
          WHEN p.weight = 'up_to_3kg' THEN 2.5
          WHEN p.weight = 'above_3kg' THEN 3.5
          ELSE NULL
        END
      ) AS weight_kg
    FROM public.orders o
    LEFT JOIN public.products p ON p.seller_id = o.seller_id AND p.name = o.product_name
    WHERE o.invoice_id = p_invoice_id AND o.delivery_status = 'delivered'
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'order_id', order_id, 'customer_name', customer_name, 'customer_phone', customer_phone,
    'product_name', product_name, 'quantity', quantity, 'price', price, 'total_amount', total_amount,
    'created_at', created_at, 'weight_kg', weight_kg,
    'total_weight_kg', CASE WHEN COALESCE(weight_kg, 0) > 0 THEN weight_kg * quantity ELSE NULL END,
    'amount_usd', ((price * quantity) / 290.0)
  ) ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_delivered_orders FROM invoice_orders;

  -- ALL orders linked to this invoice (for full audit visibility)
  WITH invoice_orders AS (
    SELECT o.id, o.order_id, o.customer_name, o.customer_phone, o.product_name, o.quantity, o.price, o.total_amount,
      o.confirmation_status, o.delivery_status, o.created_at,
      COALESCE(p.weight_kg,
        CASE
          WHEN p.weight = 'up_to_1kg' THEN 0.5
          WHEN p.weight = 'up_to_2kg' THEN 1.5
          WHEN p.weight = 'up_to_3kg' THEN 2.5
          WHEN p.weight = 'above_3kg' THEN 3.5
          ELSE NULL
        END
      ) AS weight_kg,
      EXISTS (
        SELECT 1 FROM public.invoice_adjustments ia
        WHERE ia.order_id = o.order_id AND ia.invoice_id = p_invoice_id
      ) AS has_adjustment
    FROM public.orders o
    LEFT JOIN public.products p ON p.seller_id = o.seller_id AND p.name = o.product_name
    WHERE o.invoice_id = p_invoice_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'order_id', order_id, 'customer_name', customer_name, 'customer_phone', customer_phone,
    'product_name', product_name, 'quantity', quantity, 'price', price, 'total_amount', total_amount,
    'created_at', created_at, 'weight_kg', weight_kg,
    'total_weight_kg', CASE WHEN COALESCE(weight_kg, 0) > 0 THEN weight_kg * quantity ELSE NULL END,
    'amount_usd', ((price * quantity) / 290.0),
    'confirmation_status', confirmation_status,
    'delivery_status', COALESCE(delivery_status, 'none'),
    'has_adjustment', has_adjustment
  ) ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_all_orders FROM invoice_orders;

  WITH invoice_orders AS (
    SELECT o.quantity,
      COALESCE(p.weight_kg,
        CASE
          WHEN p.weight = 'up_to_1kg' THEN 0.5
          WHEN p.weight = 'up_to_2kg' THEN 1.5
          WHEN p.weight = 'up_to_3kg' THEN 2.5
          WHEN p.weight = 'above_3kg' THEN 3.5
          ELSE NULL
        END
      ) AS weight_kg,
      EXISTS (SELECT 1 FROM public.order_history oh WHERE oh.order_id = o.order_id AND oh.field_changed = 'delivery_status' AND oh.new_value = 'shipped') AS has_shipment_event
    FROM public.orders o
    LEFT JOIN public.products p ON p.seller_id = o.seller_id AND p.name = o.product_name
    WHERE o.invoice_id = p_invoice_id
  ), shipping_lines AS (
    SELECT
      CASE WHEN CEIL(weight_kg * quantity) <= 1 THEN '≤1 KG' WHEN CEIL(weight_kg * quantity) <= 2 THEN '≤2 KG' WHEN CEIL(weight_kg * quantity) <= 3 THEN '≤3 KG' ELSE '>3 KG' END AS bracket,
      CASE WHEN CEIL(weight_kg * quantity) <= 1 THEN 1 WHEN CEIL(weight_kg * quantity) <= 2 THEN 2 WHEN CEIL(weight_kg * quantity) <= 3 THEN 3 ELSE 4 END AS sort_order,
      CASE WHEN CEIL(weight_kg * quantity) <= 1 THEN COALESCE(v_seller_rates.rate_1kg, 0) WHEN CEIL(weight_kg * quantity) <= 2 THEN COALESCE(v_seller_rates.rate_2kg, 0) WHEN CEIL(weight_kg * quantity) <= 3 THEN COALESCE(v_seller_rates.rate_3kg, 0) ELSE COALESCE(v_seller_rates.rate_3kg_plus, COALESCE(v_seller_rates.rate_3kg, 0)) END AS fee
    FROM invoice_orders WHERE has_shipment_event = true AND COALESCE(weight_kg, 0) > 0
  ), grouped AS (
    SELECT bracket, sort_order, COUNT(*)::integer AS order_count, COALESCE(SUM(fee), 0)::numeric AS fee_total
    FROM shipping_lines GROUP BY bracket, sort_order ORDER BY sort_order
  )
  SELECT COALESCE(SUM(fee_total), 0)::numeric,
    COALESCE(jsonb_agg(jsonb_build_object('bracket', bracket, 'count', order_count, 'fee', fee_total) ORDER BY sort_order), '[]'::jsonb)
  INTO v_shipping_fees, v_shipping_breakdown FROM grouped;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'invoice_id', invoice_id, 'type', type, 'amount', amount, 'reason', reason, 'created_at', created_at) ORDER BY created_at ASC), '[]'::jsonb),
    COALESCE(SUM(CASE WHEN type = 'out' THEN -amount ELSE amount END), 0)::numeric
  INTO v_addons, v_addon_net FROM public.invoice_addons WHERE invoice_id = p_invoice_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'order_id', order_id, 'seller_id', seller_id, 'invoice_id', invoice_id,
    'applied_invoice_id', applied_invoice_id, 'old_status', old_status, 'new_status', new_status,
    'difference', difference, 'difference_usd', difference / 290.0,
    'shipping_difference', shipping_difference,
    'previous_shipping_fee', previous_shipping_fee, 'new_shipping_fee', new_shipping_fee,
    'total_adjustment', (difference + shipping_difference),
    'total_adjustment_usd', (difference + shipping_difference) / 290.0,
    'reason', reason, 'status', status, 'created_at', created_at
  ) ORDER BY created_at ASC), '[]'::jsonb),
    COALESCE(SUM((difference + shipping_difference) / 290.0), 0)::numeric
  INTO v_adjustments, v_adjustment_net FROM public.invoice_adjustments WHERE applied_invoice_id = p_invoice_id AND status = 'approved';

  v_call_center_fees := (COALESCE(v_all_period_count, 0) * COALESCE(v_dropped_rate, 0)) + (COALESCE(v_period_confirmed_count, 0) * COALESCE(v_confirmed_rate, 0));
  v_cod_fees := COALESCE(v_delivered_revenue_usd, 0) * (COALESCE(v_cod_fee_percentage, 0) / 100.0);
  v_net_payable := COALESCE(v_delivered_revenue_usd, 0) - COALESCE(v_shipping_fees, 0) - COALESCE(v_call_center_fees, 0) - COALESCE(v_cod_fees, 0) + COALESCE(v_addon_net, 0) + COALESCE(v_adjustment_net, 0) + COALESCE(v_previous_balance, 0);

  RETURN jsonb_build_object(
    'invoice', jsonb_build_object('id', v_invoice.id, 'invoice_number', v_invoice.invoice_number, 'seller_id', v_invoice.seller_id, 'status', v_invoice.status, 'created_at', v_invoice.created_at, 'finalized_at', v_invoice.finalized_at, 'paid_at', v_invoice.paid_at, 'paid_by', v_invoice.paid_by, 'payment_proof_url', v_invoice.payment_proof_url, 'previous_balance', COALESCE(v_previous_balance, 0)),
    'rates', jsonb_build_object('shipping', jsonb_build_object('rate_1kg', COALESCE(v_seller_rates.rate_1kg, 0), 'rate_2kg', COALESCE(v_seller_rates.rate_2kg, 0), 'rate_3kg', COALESCE(v_seller_rates.rate_3kg, 0), 'rate_3kg_plus', COALESCE(v_seller_rates.rate_3kg_plus, COALESCE(v_seller_rates.rate_3kg, 0))), 'call_center', jsonb_build_object('confirmed_rate', COALESCE(v_confirmed_rate, 0), 'dropped_rate', COALESCE(v_dropped_rate, 0)), 'cod_fee_percentage', COALESCE(v_cod_fee_percentage, 0)),
    'counts', jsonb_build_object('total_orders_count', COALESCE(v_all_period_count, 0), 'delivered_count', COALESCE(v_delivered_count, 0), 'shipped_count', COALESCE(v_shipped_count, 0), 'confirmed_count', COALESCE(v_period_confirmed_count, 0), 'dropped_count', COALESCE(v_all_period_count, 0)),
    'call_center_breakdown', jsonb_build_object('confirmed_count', COALESCE(v_period_confirmed_count, 0), 'confirmed_rate', COALESCE(v_confirmed_rate, 0), 'confirmed_fees', COALESCE(v_period_confirmed_count, 0) * COALESCE(v_confirmed_rate, 0), 'dropped_count', COALESCE(v_all_period_count, 0), 'dropped_rate', COALESCE(v_dropped_rate, 0), 'dropped_fees', COALESCE(v_all_period_count, 0) * COALESCE(v_dropped_rate, 0)),
    'delivered_orders', v_delivered_orders,
    'all_orders', v_all_orders,
    'shipping_breakdown', v_shipping_breakdown,
    'addons', v_addons,
    'adjustments', v_adjustments,
    'totals', jsonb_build_object('delivered_revenue_usd', COALESCE(v_delivered_revenue_usd, 0), 'shipping_fees', COALESCE(v_shipping_fees, 0), 'call_center_fees', COALESCE(v_call_center_fees, 0), 'cod_fees', COALESCE(v_cod_fees, 0), 'addon_net', COALESCE(v_addon_net, 0), 'adjustment_net', COALESCE(v_adjustment_net, 0), 'previous_balance', COALESCE(v_previous_balance, 0), 'net_payable', COALESCE(v_net_payable, 0))
  );
END;
$function$;
