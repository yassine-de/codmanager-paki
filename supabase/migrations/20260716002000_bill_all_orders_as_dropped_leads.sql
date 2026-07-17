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
    count(*)::integer,
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
         COALESCE(sum(adj.difference + COALESCE(adj.shipping_difference, 0)), 0)
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
