
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

  -- Calculate shipping difference ONLY if quantity changed
  IF v_quantity_changed THEN
    SELECT EXISTS (
      SELECT 1 FROM public.order_history oh
      WHERE oh.order_id = OLD.order_id
        AND oh.field_changed = 'delivery_status'
        AND oh.new_value = 'shipped'
        AND oh.created_at <= COALESCE(v_invoice_finalized_at, now())
    ) INTO v_has_shipment_in_closed_invoice;

    IF v_has_shipment_in_closed_invoice THEN
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

      IF v_weight_kg IS NOT NULL AND v_weight_kg > 0 THEN
        SELECT * INTO v_seller_rates
        FROM public.seller_rates
        WHERE user_id = OLD.seller_id
        LIMIT 1;

        IF FOUND THEN
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

          v_shipping_diff := v_new_shipping - v_prev_shipping;
        END IF;
      END IF;
    END IF;
  END IF;

  -- CASE: delivery_status changed
  IF OLD.delivery_status IS DISTINCT FROM NEW.delivery_status THEN
    v_old_status := COALESCE(OLD.delivery_status, 'none');
    v_new_status := COALESCE(NEW.delivery_status, 'none');
    v_diff := 0;

    IF OLD.delivery_status = 'delivered' AND NEW.delivery_status != 'delivered' THEN
      v_diff := -(OLD.price * OLD.quantity);
      v_reason := 'delivery_status_change';
    END IF;

    IF v_diff != 0 THEN
      INSERT INTO public.invoice_adjustments (
        order_id, seller_id, invoice_id,
        old_status, new_status,
        previous_amount, new_amount, difference,
        previous_shipping_fee, new_shipping_fee, shipping_difference,
        reason, status
      ) VALUES (
        NEW.order_id, NEW.seller_id, OLD.invoice_id,
        v_old_status, v_new_status,
        OLD.price * OLD.quantity, 0, v_diff,
        0, 0, 0,
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

  -- CASE: confirmation_status changed
  -- ONLY create adjustment if order WAS ALREADY CONFIRMED in the closed invoice
  IF OLD.confirmation_status IS DISTINCT FROM NEW.confirmation_status THEN
    IF OLD.confirmation_status = 'confirmed' THEN
      v_old_status := OLD.confirmation_status;
      v_new_status := NEW.confirmation_status;

      INSERT INTO public.invoice_adjustments (
        order_id, seller_id, invoice_id,
        old_status, new_status,
        previous_amount, new_amount, difference,
        previous_shipping_fee, new_shipping_fee, shipping_difference,
        reason, status
      ) VALUES (
        NEW.order_id, NEW.seller_id, OLD.invoice_id,
        v_old_status, v_new_status,
        0, 0, 0, 0, 0, 0,
        'confirmation_status_change', 'pending'
      ) RETURNING id INTO v_adj_id;

      INSERT INTO public.invoice_history (
        invoice_id, event_type, field_changed,
        old_value, new_value, order_id, changed_by
      ) VALUES (
        OLD.invoice_id, 'adjustment_created', 'confirmation_status',
        v_old_status, v_new_status, NEW.order_id, auth.uid()
      );
    END IF;
    -- If OLD was NOT 'confirmed' (e.g. no_answer → confirmed), skip adjustment.
    -- This is a NEW event handled normally by the current invoice.
  END IF;

  -- CASE: Only quantity changed (no status change)
  IF v_quantity_changed
     AND OLD.delivery_status IS NOT DISTINCT FROM NEW.delivery_status
     AND OLD.confirmation_status IS NOT DISTINCT FROM NEW.confirmation_status
  THEN
    v_diff := 0;
    IF NEW.delivery_status = 'delivered' THEN
      v_diff := (NEW.price * NEW.quantity) - (OLD.price * OLD.quantity);
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
        'quantity_change', 'pending'
      ) RETURNING id INTO v_adj_id;

      INSERT INTO public.invoice_history (
        invoice_id, event_type, field_changed,
        old_value, new_value, order_id, changed_by
      ) VALUES (
        OLD.invoice_id, 'adjustment_created', 'quantity',
        OLD.quantity::text, NEW.quantity::text, NEW.order_id, auth.uid()
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
