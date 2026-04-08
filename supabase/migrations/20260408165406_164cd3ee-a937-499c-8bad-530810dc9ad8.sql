
CREATE OR REPLACE FUNCTION public.get_invoice_summary(p_invoice_id uuid)
 RETURNS json
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
  v_invoice_confirmed_count integer := 0;
  v_cross_confirmed_count integer := 0;
  v_delivered_revenue_usd numeric := 0;
  v_shipping_fees numeric := 0;
  v_call_center_fees numeric := 0;
  v_cod_fees numeric := 0;
  v_addon_net numeric := 0;
  v_adjustment_net_pkr numeric := 0;
  v_adjustment_net numeric := 0;
  v_net_payable numeric := 0;
  v_delivered_orders jsonb := '[]'::jsonb;
  v_all_orders jsonb := '[]'::jsonb;
  v_shipping_breakdown jsonb := '[]'::jsonb;
  v_addons jsonb := '[]'::jsonb;
  v_adjustments jsonb := '[]'::jsonb;
  v_cross_shipped_count integer := 0;
  v_cross_delivered_count integer := 0;
  v_cross_orders jsonb := '[]'::jsonb;
  v_cross_delivered_orders jsonb := '[]'::jsonb;
  v_cross_shipping_fees numeric := 0;
  v_cross_delivered_revenue numeric := 0;
  v_cross_delivered_only_count integer := 0;
  v_cross_delivered_only_orders jsonb := '[]'::jsonb;
  v_cross_delivered_only_all jsonb := '[]'::jsonb;
  v_cross_delivered_only_revenue numeric := 0;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_rate_1kg numeric := 0;
  v_rate_2kg numeric := 0;
  v_rate_3kg numeric := 0;
  v_rate_3kg_plus numeric := 0;
  v_pkr_rate numeric := 290.0;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;

  v_period_end := COALESCE(v_invoice.finalized_at, now());
  SELECT COALESCE(MAX(finalized_at), v_invoice.created_at)
    INTO v_period_start FROM public.invoices
    WHERE seller_id = v_invoice.seller_id AND id != p_invoice_id AND finalized_at IS NOT NULL AND finalized_at < v_period_end;

  SELECT * INTO v_seller_rates FROM public.seller_rates WHERE user_id = v_invoice.seller_id LIMIT 1;
  IF FOUND THEN
    v_rate_1kg := v_seller_rates.rate_1kg; v_rate_2kg := v_seller_rates.rate_2kg;
    v_rate_3kg := v_seller_rates.rate_3kg; v_rate_3kg_plus := v_seller_rates.rate_3kg_plus;
  END IF;

  SELECT COALESCE(confirmed_order_rate,0), COALESCE(dropped_order_rate,0), COALESCE(cod_fee_per_delivery,0)
    INTO v_confirmed_rate, v_dropped_rate, v_cod_fee_percentage
    FROM public.rate_settings
    WHERE (seller_id = v_invoice.seller_id AND is_custom = true) OR (is_global = true AND seller_id IS NULL)
    ORDER BY is_custom DESC LIMIT 1;

  v_previous_balance := v_invoice.previous_balance;

  SELECT COUNT(*) INTO v_total_orders_count FROM public.orders WHERE invoice_id = p_invoice_id;
  SELECT COUNT(*) INTO v_delivered_count FROM public.orders WHERE invoice_id = p_invoice_id AND delivery_status = 'delivered';

  SELECT COUNT(*) INTO v_shipped_count
  FROM public.orders o
  WHERE o.invoice_id = p_invoice_id
    AND EXISTS (
      SELECT 1 FROM public.order_history oh
      WHERE oh.order_id = o.order_id AND oh.field_changed = 'delivery_status' AND oh.new_value = 'shipped'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.order_history oh2
      WHERE oh2.order_id = o.order_id AND oh2.field_changed = 'delivery_status' AND oh2.new_value = 'shipped'
        AND oh2.created_at <= v_period_start
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.order_history oh_last
      WHERE oh_last.order_id = o.order_id
        AND oh_last.field_changed = 'delivery_status'
        AND oh_last.created_at > v_period_start
        AND oh_last.created_at <= v_period_end
        AND oh_last.created_at = (
          SELECT MAX(created_at) FROM public.order_history
          WHERE order_id = o.order_id AND field_changed = 'delivery_status'
            AND created_at > v_period_start AND created_at <= v_period_end
        )
        AND oh_last.new_value NOT IN ('shipped','in_transit','with_courier','delivered','returned')
    );

  SELECT COUNT(*) INTO v_dropped_count
  FROM public.orders o
  WHERE o.seller_id = v_invoice.seller_id
    AND o.created_at > v_period_start
    AND o.created_at <= v_period_end;

  SELECT COUNT(*) INTO v_invoice_confirmed_count
  FROM public.orders o
  WHERE o.invoice_id = p_invoice_id
    AND EXISTS (
      SELECT 1 FROM public.order_history oh
      WHERE oh.order_id = o.order_id
        AND oh.field_changed = 'confirmation_status'
        AND oh.new_value = 'confirmed'
        AND oh.created_at > v_period_start
        AND oh.created_at <= v_period_end
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.order_history oh_later
      WHERE oh_later.order_id = o.order_id
        AND oh_later.field_changed = 'confirmation_status'
        AND oh_later.created_at > v_period_start
        AND oh_later.created_at <= v_period_end
        AND oh_later.created_at = (
          SELECT MAX(oh_max.created_at) FROM public.order_history oh_max
          WHERE oh_max.order_id = o.order_id
            AND oh_max.field_changed = 'confirmation_status'
            AND oh_max.created_at > v_period_start
            AND oh_max.created_at <= v_period_end
        )
        AND oh_later.new_value != 'confirmed'
    );

  SELECT COUNT(*) INTO v_cross_confirmed_count
  FROM public.orders o
  JOIN public.invoices inv_orig ON inv_orig.id = o.invoice_id
  WHERE o.seller_id = v_invoice.seller_id
    AND o.invoice_id != p_invoice_id
    AND inv_orig.status IN ('ready','paid')
    AND inv_orig.finalized_at IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.order_history oh
      WHERE oh.order_id = o.order_id
        AND oh.field_changed = 'confirmation_status'
        AND oh.new_value = 'confirmed'
        AND oh.created_at > inv_orig.finalized_at
        AND oh.created_at > v_period_start
        AND oh.created_at <= v_period_end
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.order_history oh_later
      WHERE oh_later.order_id = o.order_id
        AND oh_later.field_changed = 'confirmation_status'
        AND oh_later.created_at > v_period_start
        AND oh_later.created_at <= v_period_end
        AND oh_later.created_at = (
          SELECT MAX(oh_max.created_at) FROM public.order_history oh_max
          WHERE oh_max.order_id = o.order_id
            AND oh_max.field_changed = 'confirmation_status'
            AND oh_max.created_at > v_period_start
            AND oh_max.created_at <= v_period_end
        )
        AND oh_later.new_value != 'confirmed'
    );

  v_confirmed_count := v_invoice_confirmed_count + v_cross_confirmed_count;

  -- Delivered orders (direct)
  WITH invoice_orders AS (
    SELECT o.id, o.order_id, o.customer_name, o.customer_phone, o.product_name, o.quantity, o.price, o.total_amount, o.created_at,
      COALESCE(p.weight_kg, CASE WHEN p.weight='up_to_1kg' THEN 0.5 WHEN p.weight='up_to_2kg' THEN 1.5 WHEN p.weight='up_to_3kg' THEN 2.5 WHEN p.weight='above_3kg' THEN 3.5 ELSE NULL END) AS weight_kg,
      false AS is_cross_invoice, NULL::text AS original_invoice_number
    FROM public.orders o LEFT JOIN public.products p ON p.seller_id = o.seller_id AND p.name = o.product_name
    WHERE o.invoice_id = p_invoice_id AND o.delivery_status = 'delivered'
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',id,'order_id',order_id,'customer_name',customer_name,'customer_phone',customer_phone,
    'product_name',product_name,'quantity',quantity,'price',price,'total_amount',total_amount,
    'created_at',created_at,'weight_kg',weight_kg,'total_weight_kg',COALESCE(weight_kg,0)*quantity,
    'amount_usd',ROUND(price*quantity/v_pkr_rate,2),'is_cross_invoice',is_cross_invoice,'original_invoice_number',original_invoice_number
  )),'[]'::jsonb) INTO v_delivered_orders FROM invoice_orders;

  -- All orders with was_delivered
  WITH invoice_orders AS (
    SELECT o.id, o.order_id, o.customer_name, o.customer_phone, o.product_name, o.quantity, o.price, o.total_amount,
      o.confirmation_status, o.delivery_status, o.created_at,
      COALESCE(p.weight_kg, CASE WHEN p.weight='up_to_1kg' THEN 0.5 WHEN p.weight='up_to_2kg' THEN 1.5 WHEN p.weight='up_to_3kg' THEN 2.5 WHEN p.weight='above_3kg' THEN 3.5 ELSE NULL END) AS weight_kg,
      EXISTS (SELECT 1 FROM public.invoice_adjustments ia WHERE ia.order_id = o.order_id AND ia.applied_invoice_id = p_invoice_id) AS has_adjustment,
      (SELECT ia.applied_invoice_id FROM public.invoice_adjustments ia WHERE ia.order_id = o.order_id AND ia.applied_invoice_id IS NOT NULL ORDER BY ia.created_at DESC LIMIT 1) AS adjustment_invoice_id,
      (SELECT inv.invoice_number FROM public.invoice_adjustments ia JOIN public.invoices inv ON inv.id = ia.applied_invoice_id WHERE ia.order_id = o.order_id AND ia.applied_invoice_id IS NOT NULL ORDER BY ia.created_at DESC LIMIT 1) AS adjustment_invoice_number,
      (o.delivered_at IS NOT NULL OR EXISTS (SELECT 1 FROM public.order_history oh WHERE oh.order_id = o.order_id AND oh.field_changed = 'delivery_status' AND oh.new_value = 'delivered')) AS was_delivered
    FROM public.orders o LEFT JOIN public.products p ON p.seller_id = o.seller_id AND p.name = o.product_name
    WHERE o.invoice_id = p_invoice_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',id,'order_id',order_id,'customer_name',customer_name,'customer_phone',customer_phone,
    'product_name',product_name,'quantity',quantity,'price',price,'total_amount',total_amount,
    'created_at',created_at,'weight_kg',weight_kg,'total_weight_kg',COALESCE(weight_kg,0)*quantity,
    'amount_usd',ROUND(price*quantity/v_pkr_rate,2),'confirmation_status',confirmation_status,
    'delivery_status',COALESCE(delivery_status,'none'),'has_adjustment',has_adjustment,
    'adjustment_invoice_id',adjustment_invoice_id,'adjustment_invoice_number',adjustment_invoice_number,
    'was_delivered',was_delivered,'is_cross_invoice',false,'original_invoice_number',NULL
  )),'[]'::jsonb) INTO v_all_orders FROM invoice_orders;

  -- Revenue from direct delivered
  SELECT COALESCE(SUM(ROUND(o.price*o.quantity/v_pkr_rate,2)),0) INTO v_delivered_revenue_usd FROM public.orders o WHERE o.invoice_id = p_invoice_id AND o.delivery_status = 'delivered';

  -- Cross-invoice shipped (FIX: check last status at finalization instead of any shipped event)
  WITH cross_shipped AS (
    SELECT o.id, o.order_id, o.customer_name, o.customer_phone, o.product_name, o.quantity, o.price, o.total_amount, o.created_at,
      o.delivery_status,
      COALESCE(p.weight_kg, CASE WHEN p.weight='up_to_1kg' THEN 0.5 WHEN p.weight='up_to_2kg' THEN 1.5 WHEN p.weight='up_to_3kg' THEN 2.5 WHEN p.weight='above_3kg' THEN 3.5 ELSE NULL END) AS weight_kg,
      inv_orig.invoice_number AS original_invoice_number
    FROM public.orders o JOIN public.invoices inv_orig ON inv_orig.id = o.invoice_id
    LEFT JOIN public.products p ON p.seller_id = o.seller_id AND p.name = o.product_name
    WHERE o.seller_id = v_invoice.seller_id AND o.invoice_id != p_invoice_id
      AND inv_orig.status IN ('ready','paid') AND inv_orig.finalized_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.order_history oh
        WHERE oh.order_id = o.order_id AND oh.field_changed = 'delivery_status' AND oh.new_value = 'shipped'
          AND oh.created_at > inv_orig.finalized_at AND oh.created_at > v_period_start AND oh.created_at <= v_period_end
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.order_history oh_last
        WHERE oh_last.order_id = o.order_id
          AND oh_last.field_changed = 'delivery_status'
          AND oh_last.created_at > v_period_start
          AND oh_last.created_at <= v_period_end
          AND oh_last.created_at = (
            SELECT MAX(created_at) FROM public.order_history
            WHERE order_id = o.order_id AND field_changed = 'delivery_status'
              AND created_at > v_period_start AND created_at <= v_period_end
          )
          AND oh_last.new_value NOT IN ('shipped','in_transit','with_courier','delivered','returned')
      )
      -- FIX: Only exclude if the LAST delivery status before finalization was shipped-like
      -- (meaning shipping was actually billed in the closed invoice)
      AND NOT EXISTS (
        SELECT 1 FROM public.order_history oh_prev
        WHERE oh_prev.order_id = o.order_id
          AND oh_prev.field_changed = 'delivery_status'
          AND oh_prev.created_at <= inv_orig.finalized_at
          AND oh_prev.created_at = (
            SELECT MAX(created_at) FROM public.order_history
            WHERE order_id = o.order_id
              AND field_changed = 'delivery_status'
              AND created_at <= inv_orig.finalized_at
          )
          AND oh_prev.new_value IN ('shipped','in_transit','with_courier','delivered','returned')
      )
  )
  SELECT COUNT(*),
    COALESCE(jsonb_agg(jsonb_build_object('id',id,'order_id',order_id,'customer_name',customer_name,'customer_phone',customer_phone,'product_name',product_name,'quantity',quantity,'price',price,'total_amount',total_amount,'created_at',created_at,'weight_kg',weight_kg,'total_weight_kg',COALESCE(weight_kg,0)*quantity,'amount_usd',ROUND(price*quantity/v_pkr_rate,2),'is_cross_invoice',true,'original_invoice_number',original_invoice_number)) FILTER (WHERE delivery_status = 'delivered'),'[]'::jsonb),
    COALESCE(jsonb_agg(jsonb_build_object('id',id,'order_id',order_id,'customer_name',customer_name,'customer_phone',customer_phone,'product_name',product_name,'quantity',quantity,'price',price,'total_amount',total_amount,'created_at',created_at,'weight_kg',weight_kg,'total_weight_kg',COALESCE(weight_kg,0)*quantity,'amount_usd',ROUND(price*quantity/v_pkr_rate,2),'confirmation_status','confirmed','delivery_status',delivery_status,'has_adjustment',false,'adjustment_invoice_id',NULL,'adjustment_invoice_number',NULL,'was_delivered',(delivery_status='delivered'),'is_cross_invoice',true,'original_invoice_number',original_invoice_number)),'[]'::jsonb)
  INTO v_cross_shipped_count, v_cross_delivered_orders, v_cross_orders FROM cross_shipped;

  -- Cross-invoice delivered-only (re-delivered after close, NOT captured by cross_shipped)
  WITH cross_delivered_only AS (
    SELECT o.id, o.order_id, o.customer_name, o.customer_phone, o.product_name, o.quantity, o.price, o.total_amount, o.created_at,
      o.delivery_status,
      COALESCE(p.weight_kg, CASE WHEN p.weight='up_to_1kg' THEN 0.5 WHEN p.weight='up_to_2kg' THEN 1.5 WHEN p.weight='up_to_3kg' THEN 2.5 WHEN p.weight='above_3kg' THEN 3.5 ELSE NULL END) AS weight_kg,
      inv_orig.invoice_number AS original_invoice_number
    FROM public.orders o
    JOIN public.invoices inv_orig ON inv_orig.id = o.invoice_id
    LEFT JOIN public.products p ON p.seller_id = o.seller_id AND p.name = o.product_name
    WHERE o.seller_id = v_invoice.seller_id
      AND o.invoice_id != p_invoice_id
      AND inv_orig.status IN ('ready','paid')
      AND inv_orig.finalized_at IS NOT NULL
      AND o.delivery_status = 'delivered'
      AND EXISTS (
        SELECT 1 FROM public.order_history oh
        WHERE oh.order_id = o.order_id
          AND oh.field_changed = 'delivery_status'
          AND oh.new_value = 'delivered'
          AND oh.created_at > inv_orig.finalized_at
          AND oh.created_at > v_period_start
          AND oh.created_at <= v_period_end
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.order_history oh_last
        WHERE oh_last.order_id = o.order_id
          AND oh_last.field_changed = 'delivery_status'
          AND oh_last.created_at > v_period_start
          AND oh_last.created_at <= v_period_end
          AND oh_last.created_at = (
            SELECT MAX(created_at) FROM public.order_history
            WHERE order_id = o.order_id
              AND field_changed = 'delivery_status'
              AND created_at > v_period_start
              AND created_at <= v_period_end
          )
          AND oh_last.new_value != 'delivered'
      )
      -- Exclude orders already captured via cross_shipped
      AND NOT EXISTS (
        SELECT 1 FROM public.order_history oh_ship
        WHERE oh_ship.order_id = o.order_id
          AND oh_ship.field_changed = 'delivery_status'
          AND oh_ship.new_value = 'shipped'
          AND oh_ship.created_at > inv_orig.finalized_at
          AND oh_ship.created_at > v_period_start
          AND oh_ship.created_at <= v_period_end
          AND NOT EXISTS (
            SELECT 1 FROM public.order_history oh_prev
            WHERE oh_prev.order_id = o.order_id
              AND oh_prev.field_changed = 'delivery_status'
              AND oh_prev.created_at <= inv_orig.finalized_at
              AND oh_prev.created_at = (
                SELECT MAX(created_at) FROM public.order_history
                WHERE order_id = o.order_id
                  AND field_changed = 'delivery_status'
                  AND created_at <= inv_orig.finalized_at
              )
              AND oh_prev.new_value IN ('shipped','in_transit','with_courier','delivered','returned')
          )
      )
  )
  SELECT COUNT(*),
    COALESCE(SUM(ROUND(price*quantity/v_pkr_rate,2)),0),
    COALESCE(jsonb_agg(jsonb_build_object(
      'id',id,'order_id',order_id,'customer_name',customer_name,'customer_phone',customer_phone,
      'product_name',product_name,'quantity',quantity,'price',price,'total_amount',total_amount,
      'created_at',created_at,'weight_kg',weight_kg,'total_weight_kg',COALESCE(weight_kg,0)*quantity,
      'amount_usd',ROUND(price*quantity/v_pkr_rate,2),'is_cross_invoice',true,'original_invoice_number',original_invoice_number
    )),'[]'::jsonb),
    COALESCE(jsonb_agg(jsonb_build_object(
      'id',id,'order_id',order_id,'customer_name',customer_name,'customer_phone',customer_phone,
      'product_name',product_name,'quantity',quantity,'price',price,'total_amount',total_amount,
      'created_at',created_at,'weight_kg',weight_kg,'total_weight_kg',COALESCE(weight_kg,0)*quantity,
      'amount_usd',ROUND(price*quantity/v_pkr_rate,2),'confirmation_status','confirmed',
      'delivery_status',delivery_status,'has_adjustment',false,'adjustment_invoice_id',NULL,
      'adjustment_invoice_number',NULL,'was_delivered',true,'is_cross_invoice',true,'original_invoice_number',original_invoice_number
    )),'[]'::jsonb)
  INTO v_cross_delivered_only_count, v_cross_delivered_only_revenue, v_cross_delivered_only_orders, v_cross_delivered_only_all
  FROM cross_delivered_only;

  v_cross_delivered_count := v_cross_delivered_only_count;

  -- Shipping breakdown (FIX: same last-status-at-finalization logic for cross-invoice half)
  WITH all_shipped AS (
    SELECT COALESCE(p.weight_kg, CASE WHEN p.weight='up_to_1kg' THEN 0.5 WHEN p.weight='up_to_2kg' THEN 1.5 WHEN p.weight='up_to_3kg' THEN 2.5 WHEN p.weight='above_3kg' THEN 3.5 ELSE 0.5 END)*o.quantity AS total_wt
    FROM public.orders o LEFT JOIN public.products p ON p.seller_id = o.seller_id AND p.name = o.product_name
    WHERE o.invoice_id = p_invoice_id
      AND EXISTS (SELECT 1 FROM public.order_history oh WHERE oh.order_id = o.order_id AND oh.field_changed = 'delivery_status' AND oh.new_value = 'shipped')
      AND NOT EXISTS (SELECT 1 FROM public.order_history oh2 WHERE oh2.order_id = o.order_id AND oh2.field_changed = 'delivery_status' AND oh2.new_value = 'shipped' AND oh2.created_at <= v_period_start)
      AND NOT EXISTS (
        SELECT 1 FROM public.order_history oh_last
        WHERE oh_last.order_id = o.order_id AND oh_last.field_changed = 'delivery_status'
          AND oh_last.created_at > v_period_start AND oh_last.created_at <= v_period_end
          AND oh_last.created_at = (SELECT MAX(created_at) FROM public.order_history WHERE order_id = o.order_id AND field_changed = 'delivery_status' AND created_at > v_period_start AND created_at <= v_period_end)
          AND oh_last.new_value NOT IN ('shipped','in_transit','with_courier','delivered','returned')
      )
    UNION ALL
    SELECT COALESCE(p.weight_kg, CASE WHEN p.weight='up_to_1kg' THEN 0.5 WHEN p.weight='up_to_2kg' THEN 1.5 WHEN p.weight='up_to_3kg' THEN 2.5 WHEN p.weight='above_3kg' THEN 3.5 ELSE 0.5 END)*o.quantity AS total_wt
    FROM public.orders o JOIN public.invoices inv_orig ON inv_orig.id = o.invoice_id
    LEFT JOIN public.products p ON p.seller_id = o.seller_id AND p.name = o.product_name
    WHERE o.seller_id = v_invoice.seller_id AND o.invoice_id != p_invoice_id
      AND inv_orig.status IN ('ready','paid') AND inv_orig.finalized_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.order_history oh WHERE oh.order_id = o.order_id AND oh.field_changed = 'delivery_status' AND oh.new_value = 'shipped' AND oh.created_at > inv_orig.finalized_at AND oh.created_at > v_period_start AND oh.created_at <= v_period_end)
      AND NOT EXISTS (
        SELECT 1 FROM public.order_history oh_last
        WHERE oh_last.order_id = o.order_id AND oh_last.field_changed = 'delivery_status'
          AND oh_last.created_at > v_period_start AND oh_last.created_at <= v_period_end
          AND oh_last.created_at = (SELECT MAX(created_at) FROM public.order_history WHERE order_id = o.order_id AND field_changed = 'delivery_status' AND created_at > v_period_start AND created_at <= v_period_end)
          AND oh_last.new_value NOT IN ('shipped','in_transit','with_courier','delivered','returned')
      )
      -- FIX: Only exclude if last status at finalization was shipped-like
      AND NOT EXISTS (
        SELECT 1 FROM public.order_history oh_prev
        WHERE oh_prev.order_id = o.order_id
          AND oh_prev.field_changed = 'delivery_status'
          AND oh_prev.created_at <= inv_orig.finalized_at
          AND oh_prev.created_at = (
            SELECT MAX(created_at) FROM public.order_history
            WHERE order_id = o.order_id
              AND field_changed = 'delivery_status'
              AND created_at <= inv_orig.finalized_at
          )
          AND oh_prev.new_value IN ('shipped','in_transit','with_courier','delivered','returned')
      )
  ), brackets AS (
    SELECT CASE WHEN total_wt<=1 THEN '0-1 KG' WHEN total_wt<=2 THEN '1-2 KG' WHEN total_wt<=3 THEN '2-3 KG' ELSE '3+ KG' END AS bracket,
      CASE WHEN total_wt<=1 THEN v_rate_1kg WHEN total_wt<=2 THEN v_rate_2kg WHEN total_wt<=3 THEN v_rate_3kg ELSE v_rate_3kg_plus END AS fee
    FROM all_shipped
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('bracket',bracket,'count',cnt,'fee',total_fee)),'[]'::jsonb)
  INTO v_shipping_breakdown FROM (SELECT bracket, COUNT(*) AS cnt, SUM(fee) AS total_fee FROM brackets GROUP BY bracket ORDER BY bracket) sub;

  SELECT COALESCE(SUM((item->>'fee')::numeric), 0) INTO v_shipping_fees FROM jsonb_array_elements(v_shipping_breakdown) AS item;
  v_shipped_count := v_shipped_count + v_cross_shipped_count;

  v_cross_delivered_revenue := v_cross_delivered_only_revenue;

  v_delivered_revenue_usd := v_delivered_revenue_usd + v_cross_delivered_revenue;
  v_delivered_orders := v_delivered_orders || v_cross_delivered_orders || v_cross_delivered_only_orders;
  v_all_orders := v_all_orders || v_cross_orders || v_cross_delivered_only_all;
  v_delivered_count := v_delivered_count + v_cross_delivered_only_count;

  v_call_center_fees := (v_confirmed_count * v_confirmed_rate) + (v_dropped_count * v_dropped_rate);
  v_cod_fees := ROUND(v_delivered_revenue_usd * (v_cod_fee_percentage / 100), 2);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'invoice_id',invoice_id,'type',type,'amount',amount,'reason',reason,'created_at',created_at)),'[]'::jsonb),
    COALESCE(SUM(CASE WHEN type='in' THEN amount ELSE -amount END),0)
  INTO v_addons, v_addon_net FROM public.invoice_addons WHERE invoice_id = p_invoice_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',id,'order_id',order_id,'seller_id',seller_id,'invoice_id',invoice_id,
    'applied_invoice_id',applied_invoice_id,'old_status',old_status,'new_status',new_status,
    'difference',difference,'difference_usd',ROUND(difference/v_pkr_rate,2),
    'shipping_difference',shipping_difference,
    'shipping_difference_usd',ROUND(shipping_difference/v_pkr_rate,2),
    'reason',reason,'status',status,'created_at',created_at
  )),'[]'::jsonb),
    COALESCE(SUM(CASE WHEN status='approved' THEN difference + shipping_difference ELSE 0 END),0)
  INTO v_adjustments, v_adjustment_net_pkr FROM public.invoice_adjustments WHERE applied_invoice_id = p_invoice_id;

  v_adjustment_net := ROUND(v_adjustment_net_pkr / v_pkr_rate, 2);
  v_net_payable := v_delivered_revenue_usd - v_shipping_fees - v_call_center_fees - v_cod_fees + v_addon_net + v_adjustment_net + v_previous_balance;

  RETURN jsonb_build_object(
    'invoice', jsonb_build_object('id',v_invoice.id,'invoice_number',v_invoice.invoice_number,'seller_id',v_invoice.seller_id,'status',v_invoice.status,'created_at',v_invoice.created_at,'finalized_at',v_invoice.finalized_at,'paid_at',v_invoice.paid_at,'paid_by',v_invoice.paid_by,'payment_proof_url',v_invoice.payment_proof_url,'previous_balance',v_previous_balance),
    'rates', jsonb_build_object('shipping',jsonb_build_object('rate_1kg',v_rate_1kg,'rate_2kg',v_rate_2kg,'rate_3kg',v_rate_3kg,'rate_3kg_plus',v_rate_3kg_plus),'call_center',jsonb_build_object('confirmed_rate',v_confirmed_rate,'dropped_rate',v_dropped_rate),'cod_fee_percentage',v_cod_fee_percentage),
    'counts', jsonb_build_object('total_orders_count',v_total_orders_count,'delivered_count',v_delivered_count,'shipped_count',v_shipped_count,'confirmed_count',v_confirmed_count,'dropped_count',v_dropped_count,'cross_shipped_count',v_cross_shipped_count,'cross_delivered_count',v_cross_delivered_count,'cross_confirmed_count',v_cross_confirmed_count),
    'call_center_breakdown', jsonb_build_object('confirmed_count',v_confirmed_count,'confirmed_rate',v_confirmed_rate,'confirmed_fees',v_confirmed_count*v_confirmed_rate,'dropped_count',v_dropped_count,'dropped_rate',v_dropped_rate,'dropped_fees',v_dropped_count*v_dropped_rate),
    'delivered_orders', v_delivered_orders, 'all_orders', v_all_orders, 'shipping_breakdown', v_shipping_breakdown, 'addons', v_addons, 'adjustments', v_adjustments,
    'totals', jsonb_build_object('delivered_revenue_usd',v_delivered_revenue_usd,'shipping_fees',v_shipping_fees,'call_center_fees',v_call_center_fees,'cod_fees',v_cod_fees,'addon_net',v_addon_net,'adjustment_net',v_adjustment_net,'previous_balance',v_previous_balance,'net_payable',v_net_payable)
  );
END;
$function$;
