
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
  v_adj_id uuid;
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
  v_shipped_statuses text[] := ARRAY['shipped','in_transit','with_courier','delivered','returned'];
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

  -- CASE 1: delivery_status changed
  IF OLD.delivery_status IS DISTINCT FROM NEW.delivery_status THEN
    v_old_status := COALESCE(OLD.delivery_status, 'none');
    v_new_status := COALESCE(NEW.delivery_status, 'none');
    v_diff := 0;
    v_shipping_diff := 0;

    -- Delivery reversal
    IF OLD.delivery_status = 'delivered' AND NEW.delivery_status != 'delivered' THEN
      v_diff := -(OLD.price * OLD.quantity);
      v_reason := 'delivery_status_change';
    END IF;

    -- Shipping reversal: was shipped → explicitly no longer in ANY shipped state
    -- FIX: Use POSITIVE value because seller already paid shipping in closed invoice,
    -- so the adjustment should REFUND (add back) the shipping fee
    IF v_was_shipped
       AND COALESCE(NEW.delivery_status, 'none') NOT IN ('shipped','in_transit','with_courier','delivered','returned')
       AND v_has_shipment_in_closed_invoice THEN
      v_shipping_diff := v_prev_shipping;  -- CHANGED: was -v_prev_shipping, now +v_prev_shipping (refund)
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
      ) RETURNING id INTO v_adj_id;

      INSERT INTO public.invoice_history (
        invoice_id, event_type, field_changed,
        old_value, new_value, order_id, changed_by
      ) VALUES (
        OLD.invoice_id, 'adjustment_created', 'delivery_status',
        v_old_status, v_new_status, NEW.order_id, auth.uid()
      );
    END IF;
  END IF;

  -- CASE 2: confirmation_status changed
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
        0, 0, 0, 0, 0, 0,
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

  -- CASE 3: Price or quantity changed (no status change)
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
