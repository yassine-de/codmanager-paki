-- Restore invoice runtime logic from the legacy system without copying legacy invoices.

ALTER TABLE public.invoices
  ALTER COLUMN paid_by TYPE text USING paid_by::text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_invoice_per_seller
  ON public.invoices (seller_id)
  WHERE status = 'open';

CREATE OR REPLACE FUNCTION public.set_invoice_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_prefix text;
  v_counter integer;
BEGIN
  IF NEW.invoice_number = '' OR NEW.invoice_number IS NULL THEN
    SELECT prefix INTO v_prefix
    FROM public.seller_order_prefixes
    WHERE seller_id = NEW.seller_id;

    IF v_prefix IS NULL THEN
      v_prefix := 'INV';
    END IF;

    INSERT INTO public.seller_invoice_counters (seller_id, current_counter)
    VALUES (NEW.seller_id, 1)
    ON CONFLICT (seller_id)
    DO UPDATE SET current_counter = public.seller_invoice_counters.current_counter + 1
    RETURNING current_counter INTO v_counter;

    NEW.invoice_number := v_prefix || '-INV-' || LPAD(v_counter::text, 3, '0');
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS set_invoice_number_trigger ON public.invoices;
CREATE TRIGGER set_invoice_number_trigger
  BEFORE INSERT ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.set_invoice_number();

CREATE OR REPLACE FUNCTION public.auto_assign_invoice_on_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_open_invoice_id uuid;
  v_new_invoice_id uuid;
  v_current_invoice_status text;
  v_has_terminal_event boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.invoice_id IS NULL THEN
      PERFORM pg_advisory_xact_lock(hashtext(NEW.seller_id::text));

      SELECT id INTO v_open_invoice_id
      FROM public.invoices
      WHERE seller_id = NEW.seller_id
        AND status = 'open'
      FOR UPDATE;

      IF v_open_invoice_id IS NOT NULL THEN
        NEW.invoice_id := v_open_invoice_id;
      ELSE
        INSERT INTO public.invoices (seller_id, status)
        VALUES (NEW.seller_id, 'open')
        RETURNING id INTO v_new_invoice_id;

        NEW.invoice_id := v_new_invoice_id;
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  v_has_terminal_event := (
    (NEW.confirmation_status = 'confirmed' AND OLD.confirmation_status IS DISTINCT FROM 'confirmed')
    OR (NEW.confirmation_status = 'cancelled' AND OLD.confirmation_status IS DISTINCT FROM 'cancelled')
    OR (NEW.confirmation_status = 'dropped' AND OLD.confirmation_status IS DISTINCT FROM 'dropped')
    OR (NEW.confirmation_status = 'unreachable' AND OLD.confirmation_status IS DISTINCT FROM 'unreachable')
    OR (NEW.delivery_status = 'shipped' AND OLD.delivery_status IS DISTINCT FROM 'shipped')
    OR (NEW.delivery_status = 'delivered' AND OLD.delivery_status IS DISTINCT FROM 'delivered')
  );

  IF v_has_terminal_event THEN
    IF NEW.invoice_id IS NOT NULL THEN
      SELECT status INTO v_current_invoice_status
      FROM public.invoices
      WHERE id = NEW.invoice_id;

      IF v_current_invoice_status IN ('ready', 'paid') THEN
        RETURN NEW;
      END IF;
    END IF;

    IF NEW.invoice_id IS NULL THEN
      PERFORM pg_advisory_xact_lock(hashtext(NEW.seller_id::text));

      SELECT id INTO v_open_invoice_id
      FROM public.invoices
      WHERE seller_id = NEW.seller_id
        AND status = 'open'
      FOR UPDATE;

      IF v_open_invoice_id IS NOT NULL THEN
        NEW.invoice_id := v_open_invoice_id;
      ELSE
        INSERT INTO public.invoices (seller_id, status)
        VALUES (NEW.seller_id, 'open')
        RETURNING id INTO v_new_invoice_id;

        NEW.invoice_id := v_new_invoice_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS auto_assign_invoice_trigger ON public.orders;
DROP TRIGGER IF EXISTS trg_auto_assign_invoice ON public.orders;
CREATE TRIGGER auto_assign_invoice_trigger
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_invoice_on_delivery();

CREATE OR REPLACE FUNCTION public.create_invoice_adjustment_on_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_status text;
  v_invoice_finalized_at timestamptz;
  v_diff numeric := 0;
  v_old_status text;
  v_new_status text;
  v_reason text;
  v_prev_shipping numeric := 0;
  v_new_shipping numeric := 0;
  v_shipping_diff numeric := 0;
  v_weight_kg numeric;
  v_old_total_weight numeric;
  v_new_total_weight numeric;
  v_seller_rates public.seller_rates%ROWTYPE;
  v_has_shipment_in_closed_invoice boolean;
  v_quantity_changed boolean;
  v_price_changed boolean;
  v_shipped_statuses text[] := ARRAY['shipped','in_transit','with_courier','out_for_delivery','failed_attempt','delivered','returned'];
  v_was_shipped boolean;
  v_now_shipped boolean;
BEGIN
  IF OLD.invoice_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT status, finalized_at INTO v_invoice_status, v_invoice_finalized_at
  FROM public.invoices
  WHERE id = OLD.invoice_id;

  IF v_invoice_status NOT IN ('ready', 'paid') THEN
    RETURN NEW;
  END IF;

  v_quantity_changed := (OLD.quantity IS DISTINCT FROM NEW.quantity);
  v_price_changed := (OLD.price IS DISTINCT FROM NEW.price);
  v_was_shipped := (COALESCE(OLD.delivery_status, 'none') = ANY(v_shipped_statuses));
  v_now_shipped := (COALESCE(NEW.delivery_status, 'none') = ANY(v_shipped_statuses));

  SELECT COALESCE(p.weight_kg,
    CASE
      WHEN p.weight = 'up_to_1kg' THEN 0.5
      WHEN p.weight = 'up_to_2kg' THEN 1.5
      WHEN p.weight = 'up_to_3kg' THEN 2.5
      WHEN p.weight = 'above_3kg' THEN 3.5
      ELSE NULL
    END
  ) INTO v_weight_kg
  FROM public.products p
  WHERE p.seller_id = OLD.seller_id AND p.name = OLD.product_name
  LIMIT 1;

  SELECT * INTO v_seller_rates
  FROM public.seller_rates
  WHERE user_id = OLD.seller_id
  LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM public.order_history oh
    WHERE oh.order_id = OLD.order_id
      AND oh.field_changed = 'delivery_status'
      AND oh.new_value = ANY(v_shipped_statuses)
      AND oh.created_at <= COALESCE(v_invoice_finalized_at, now())
  ) INTO v_has_shipment_in_closed_invoice;

  IF (v_quantity_changed OR v_price_changed OR (OLD.delivery_status IS DISTINCT FROM NEW.delivery_status))
     AND v_weight_kg IS NOT NULL AND v_weight_kg > 0 AND FOUND THEN
    v_old_total_weight := CEIL(v_weight_kg * OLD.quantity);
    v_prev_shipping := CASE
      WHEN v_old_total_weight <= 1 THEN COALESCE(v_seller_rates.rate_1kg, 0)
      WHEN v_old_total_weight <= 2 THEN COALESCE(v_seller_rates.rate_2kg, 0)
      WHEN v_old_total_weight <= 3 THEN COALESCE(v_seller_rates.rate_3kg, 0)
      ELSE COALESCE(v_seller_rates.rate_3kg_plus, v_seller_rates.rate_3kg, 0)
    END;

    v_new_total_weight := CEIL(v_weight_kg * NEW.quantity);
    v_new_shipping := CASE
      WHEN v_new_total_weight <= 1 THEN COALESCE(v_seller_rates.rate_1kg, 0)
      WHEN v_new_total_weight <= 2 THEN COALESCE(v_seller_rates.rate_2kg, 0)
      WHEN v_new_total_weight <= 3 THEN COALESCE(v_seller_rates.rate_3kg, 0)
      ELSE COALESCE(v_seller_rates.rate_3kg_plus, v_seller_rates.rate_3kg, 0)
    END;
  END IF;

  IF OLD.delivery_status IS DISTINCT FROM NEW.delivery_status THEN
    v_old_status := COALESCE(OLD.delivery_status, 'none');
    v_new_status := COALESCE(NEW.delivery_status, 'none');
    v_diff := 0;
    v_shipping_diff := 0;

    IF OLD.delivery_status = 'delivered' AND COALESCE(NEW.delivery_status, 'none') != 'delivered' THEN
      v_diff := -(OLD.price * OLD.quantity);
      v_reason := 'delivery_status_change';
    END IF;

    IF v_was_shipped
       AND COALESCE(NEW.delivery_status, 'none') NOT IN (
         'shipped','in_transit','with_courier','delivered','returned',
         'out_for_delivery','failed_attempt','ready_for_return','return'
       )
       AND v_has_shipment_in_closed_invoice THEN
      v_shipping_diff := v_prev_shipping;
      IF v_reason IS NULL THEN
        v_reason := 'shipping_reversal';
      END IF;
    END IF;

    IF v_diff != 0 OR v_shipping_diff != 0 THEN
      INSERT INTO public.invoice_adjustments (
        order_id, seller_id, invoice_id,
        old_status, new_status,
        previous_amount, new_amount, difference,
        previous_shipping_fee, new_shipping_fee, shipping_difference,
        reason, status
      ) VALUES (
        NEW.order_id, NEW.seller_id, OLD.invoice_id,
        v_old_status, v_new_status,
        CASE WHEN v_diff != 0 THEN OLD.price * OLD.quantity ELSE 0 END,
        0, v_diff,
        CASE WHEN v_shipping_diff != 0 THEN v_prev_shipping ELSE 0 END,
        0, v_shipping_diff,
        v_reason, 'pending'
      );

      INSERT INTO public.invoice_history (
        invoice_id, event_type, field_changed,
        old_value, new_value, order_id, changed_by
      ) VALUES (
        OLD.invoice_id, 'adjustment_created', 'delivery_status',
        v_old_status, v_new_status, NEW.order_id, auth.uid()
      );
    END IF;
  END IF;

  IF OLD.confirmation_status IS DISTINCT FROM NEW.confirmation_status THEN
    IF OLD.confirmation_status = 'confirmed' THEN
      INSERT INTO public.invoice_adjustments (
        order_id, seller_id, invoice_id,
        old_status, new_status,
        previous_amount, new_amount, difference,
        previous_shipping_fee, new_shipping_fee, shipping_difference,
        reason, status
      ) VALUES (
        NEW.order_id, NEW.seller_id, OLD.invoice_id,
        OLD.confirmation_status, NEW.confirmation_status,
        OLD.price * OLD.quantity, 0, -(OLD.price * OLD.quantity), 0, 0, 0,
        'confirmation_status_change', 'pending'
      );

      INSERT INTO public.invoice_history (
        invoice_id, event_type, field_changed,
        old_value, new_value, order_id, changed_by
      ) VALUES (
        OLD.invoice_id, 'adjustment_created', 'confirmation_status',
        OLD.confirmation_status, NEW.confirmation_status, NEW.order_id, auth.uid()
      );
    END IF;
  END IF;

  IF (v_quantity_changed OR v_price_changed)
     AND OLD.delivery_status IS NOT DISTINCT FROM NEW.delivery_status
     AND OLD.confirmation_status IS NOT DISTINCT FROM NEW.confirmation_status
  THEN
    v_diff := 0;
    v_shipping_diff := 0;

    IF NEW.delivery_status = 'delivered' THEN
      v_diff := (NEW.price * NEW.quantity) - (OLD.price * OLD.quantity);
    END IF;

    IF v_quantity_changed AND v_has_shipment_in_closed_invoice
       AND v_weight_kg IS NOT NULL AND v_weight_kg > 0 THEN
      v_shipping_diff := v_new_shipping - v_prev_shipping;
    END IF;

    IF v_diff != 0 OR v_shipping_diff != 0 THEN
      INSERT INTO public.invoice_adjustments (
        order_id, seller_id, invoice_id,
        old_status, new_status,
        previous_amount, new_amount, difference,
        previous_shipping_fee, new_shipping_fee, shipping_difference,
        reason, status
      ) VALUES (
        NEW.order_id, NEW.seller_id, OLD.invoice_id,
        COALESCE(NEW.delivery_status, NEW.confirmation_status, 'unchanged'),
        COALESCE(NEW.delivery_status, NEW.confirmation_status, 'unchanged'),
        OLD.price * OLD.quantity, NEW.price * NEW.quantity, v_diff,
        v_prev_shipping, v_new_shipping, v_shipping_diff,
        CASE WHEN v_price_changed AND v_quantity_changed THEN 'price_quantity_change'
             WHEN v_price_changed THEN 'price_change'
             ELSE 'quantity_change' END,
        'pending'
      );

      INSERT INTO public.invoice_history (
        invoice_id, event_type, field_changed,
        old_value, new_value, order_id, changed_by
      ) VALUES (
        OLD.invoice_id, 'adjustment_created',
        CASE WHEN v_price_changed THEN 'price' ELSE 'quantity' END,
        CASE WHEN v_price_changed THEN OLD.price::text ELSE OLD.quantity::text END,
        CASE WHEN v_price_changed THEN NEW.price::text ELSE NEW.quantity::text END,
        NEW.order_id, auth.uid()
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_invoice_adjustment_on_status_change ON public.orders;
CREATE TRIGGER trg_invoice_adjustment_on_status_change
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.create_invoice_adjustment_on_status_change();

CREATE OR REPLACE FUNCTION public.get_invoice_summary(p_invoice_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_seller_rates public.seller_rates%ROWTYPE;
  v_rate_settings public.rate_settings%ROWTYPE;
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
  v_adjustment_net_pkr numeric := 0;
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

  SELECT * INTO v_seller_rates
  FROM public.seller_rates
  WHERE user_id = v_invoice.seller_id
  LIMIT 1;

  SELECT * INTO v_rate_settings
  FROM public.rate_settings
  WHERE (seller_id = v_invoice.seller_id AND is_custom = true)
     OR (seller_id IS NULL AND is_global = true)
  ORDER BY is_custom DESC, is_global DESC
  LIMIT 1;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE delivery_status = 'delivered')::integer,
    count(*) FILTER (WHERE delivery_status IN ('shipped','in_transit','with_courier','out_for_delivery','failed_attempt','delivered','returned'))::integer,
    count(*) FILTER (WHERE confirmation_status = 'confirmed')::integer,
    count(*) FILTER (WHERE confirmation_status IN ('cancelled','dropped','unreachable'))::integer,
    COALESCE(sum(price * quantity) FILTER (WHERE delivery_status = 'delivered'), 0) / v_pkr_rate
  INTO v_total_orders_count, v_delivered_count, v_shipped_count, v_confirmed_count, v_dropped_count, v_delivered_revenue_usd
  FROM public.orders
  WHERE invoice_id = p_invoice_id;

  v_call_center_fees :=
    v_confirmed_count * COALESCE(v_rate_settings.confirmed_order_rate, 0) +
    v_dropped_count * COALESCE(v_rate_settings.dropped_order_rate, 0);
  v_cod_fees := round(v_delivered_revenue_usd * COALESCE(v_rate_settings.cod_fee_per_delivery, 0) / 100, 2);

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
      'amount_usd', round(price * quantity / v_pkr_rate, 2),
      'confirmation_status', confirmation_status,
      'delivery_status', COALESCE(delivery_status, 'none'),
      'has_adjustment', EXISTS (SELECT 1 FROM public.invoice_adjustments ia WHERE ia.order_id = order_weights.order_id AND ia.applied_invoice_id IS NOT NULL),
      'adjustment_invoice_id', (SELECT ia.applied_invoice_id FROM public.invoice_adjustments ia WHERE ia.order_id = order_weights.order_id AND ia.applied_invoice_id IS NOT NULL ORDER BY ia.created_at DESC LIMIT 1),
      'adjustment_invoice_number', (SELECT inv.invoice_number FROM public.invoice_adjustments ia JOIN public.invoices inv ON inv.id = ia.applied_invoice_id WHERE ia.order_id = order_weights.order_id AND ia.applied_invoice_id IS NOT NULL ORDER BY ia.created_at DESC LIMIT 1),
      'was_delivered', delivery_status = 'delivered',
      'is_cross_invoice', false,
      'original_invoice_number', NULL
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
      'amount_usd', round(price * quantity / v_pkr_rate, 2),
      'is_cross_invoice', false,
      'original_invoice_number', NULL
    ) ORDER BY created_at DESC) FILTER (WHERE delivery_status = 'delivered'), '[]'::jsonb)
  INTO v_all_orders, v_delivered_orders
  FROM order_weights;

  WITH shipped_weights AS (
    SELECT
      COALESCE(p.weight_kg, CASE
        WHEN p.weight = 'up_to_1kg' THEN 0.5
        WHEN p.weight = 'up_to_2kg' THEN 1.5
        WHEN p.weight = 'up_to_3kg' THEN 2.5
        WHEN p.weight = 'above_3kg' THEN 3.5
        ELSE 0.5
      END) * o.quantity AS total_weight
    FROM public.orders o
    LEFT JOIN public.products p ON p.seller_id = o.seller_id AND p.name = o.product_name
    WHERE o.invoice_id = p_invoice_id
      AND o.delivery_status IN ('shipped','in_transit','with_courier','out_for_delivery','failed_attempt','delivered','returned')
  ),
  brackets AS (
    SELECT
      CASE
        WHEN total_weight <= 1 THEN '0-1 KG'
        WHEN total_weight <= 2 THEN '1-2 KG'
        WHEN total_weight <= 3 THEN '2-3 KG'
        ELSE '3+ KG'
      END AS bracket,
      CASE
        WHEN total_weight <= 1 THEN COALESCE(v_seller_rates.rate_1kg, 0)
        WHEN total_weight <= 2 THEN COALESCE(v_seller_rates.rate_2kg, 0)
        WHEN total_weight <= 3 THEN COALESCE(v_seller_rates.rate_3kg, 0)
        ELSE COALESCE(v_seller_rates.rate_3kg_plus, v_seller_rates.rate_3kg, 0)
      END AS fee
    FROM shipped_weights
  ),
  grouped AS (
    SELECT bracket, count(*) AS count, sum(fee) AS fee
    FROM brackets
    GROUP BY bracket
    ORDER BY bracket
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('bracket', bracket, 'count', count, 'fee', fee)), '[]'::jsonb),
         COALESCE(sum(fee), 0)
  INTO v_shipping_breakdown, v_shipping_fees
  FROM grouped;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'invoice_id', invoice_id, 'type', type, 'amount', amount, 'reason', reason, 'created_at', created_at) ORDER BY created_at DESC), '[]'::jsonb),
         COALESCE(sum(CASE WHEN type = 'in' THEN amount ELSE -amount END), 0)
  INTO v_addons, v_addon_net
  FROM public.invoice_addons
  WHERE invoice_id = p_invoice_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id,
      'order_id', order_id,
      'seller_id', seller_id,
      'invoice_id', invoice_id,
      'applied_invoice_id', applied_invoice_id,
      'old_status', old_status,
      'new_status', new_status,
      'difference', difference,
      'difference_usd', round(difference / v_pkr_rate, 2),
      'shipping_difference', shipping_difference,
      'shipping_difference_usd', round(shipping_difference / v_pkr_rate, 2),
      'reason', reason,
      'status', status,
      'created_at', created_at
    ) ORDER BY created_at DESC), '[]'::jsonb),
    COALESCE(sum(CASE WHEN status = 'approved' THEN difference + shipping_difference ELSE 0 END), 0)
  INTO v_adjustments, v_adjustment_net_pkr
  FROM public.invoice_adjustments
  WHERE applied_invoice_id = p_invoice_id OR invoice_id = p_invoice_id;

  v_adjustment_net := round(v_adjustment_net_pkr / v_pkr_rate, 2);

  RETURN jsonb_build_object(
    'invoice', to_jsonb(v_invoice),
    'rates', jsonb_build_object(
      'shipping', jsonb_build_object(
        'rate_1kg', COALESCE(v_seller_rates.rate_1kg, 0),
        'rate_2kg', COALESCE(v_seller_rates.rate_2kg, 0),
        'rate_3kg', COALESCE(v_seller_rates.rate_3kg, 0),
        'rate_3kg_plus', COALESCE(v_seller_rates.rate_3kg_plus, 0)
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
$function$;

NOTIFY pgrst, 'reload schema';
