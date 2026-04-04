
-- Drop old trigger first
DROP TRIGGER IF EXISTS trg_invoice_adjustment_on_status_change ON public.orders;
DROP FUNCTION IF EXISTS public.create_invoice_adjustment_on_status_change();

-- Rebuild: new trigger function
CREATE OR REPLACE FUNCTION public.create_invoice_adjustment_on_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_status text;
  v_diff numeric := 0;
  v_old_status text;
  v_new_status text;
  v_reason text;
  v_adj_id uuid;
BEGIN
  -- Only proceed if the order has an invoice
  IF OLD.invoice_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get invoice status
  SELECT status INTO v_invoice_status
  FROM public.invoices
  WHERE id = OLD.invoice_id;

  -- If invoice is OPEN, changes are live — no adjustment needed
  IF v_invoice_status NOT IN ('ready', 'paid') THEN
    RETURN NEW;
  END IF;

  -- CASE: delivery_status changed (e.g., delivered → returned)
  IF OLD.delivery_status IS DISTINCT FROM NEW.delivery_status THEN
    v_old_status := COALESCE(OLD.delivery_status, 'none');
    v_new_status := COALESCE(NEW.delivery_status, 'none');

    -- Calculate exact financial impact
    IF OLD.delivery_status = 'delivered' AND NEW.delivery_status != 'delivered' THEN
      -- Was delivered, now not → negative adjustment (lose the revenue)
      v_diff := -(OLD.price * OLD.quantity);
      v_reason := 'delivery_status_change';
    ELSIF OLD.delivery_status != 'delivered' AND NEW.delivery_status = 'delivered' THEN
      -- Wasn't delivered, now is → positive adjustment (gain revenue)
      v_diff := NEW.price * NEW.quantity;
      v_reason := 'delivery_status_change';
    END IF;

    IF v_diff != 0 THEN
      INSERT INTO public.invoice_adjustments (
        order_id, seller_id, invoice_id,
        old_status, new_status,
        previous_amount, new_amount, difference,
        reason, status
      ) VALUES (
        NEW.order_id, NEW.seller_id, OLD.invoice_id,
        v_old_status, v_new_status,
        CASE WHEN OLD.delivery_status = 'delivered' THEN OLD.price * OLD.quantity ELSE 0 END,
        CASE WHEN NEW.delivery_status = 'delivered' THEN NEW.price * NEW.quantity ELSE 0 END,
        v_diff,
        v_reason, 'pending'
      ) RETURNING id INTO v_adj_id;

      -- Log to invoice_history
      INSERT INTO public.invoice_history (
        invoice_id, event_type, field_changed,
        old_value, new_value, order_id, changed_by
      ) VALUES (
        OLD.invoice_id, 'adjustment_created', 'delivery_status',
        v_old_status, v_new_status,
        NEW.order_id, auth.uid()
      );
    END IF;
  END IF;

  -- CASE: confirmation_status changed (e.g., confirmed → cancelled)
  IF OLD.confirmation_status IS DISTINCT FROM NEW.confirmation_status THEN
    v_old_status := OLD.confirmation_status;
    v_new_status := NEW.confirmation_status;
    v_diff := 0;

    -- Confirmation changes affect call center fees, not revenue directly
    -- The financial impact depends on the rate difference
    -- For simplicity and accuracy, we track the status change
    -- The invoice summary recalculates fees based on current statuses
    -- But for closed invoices, we need to record the delta

    -- If order was confirmed and is now dropped → adjustment for call center fee difference
    -- difference = (confirmed_rate - dropped_rate) as a negative (we charged confirmed, should have charged dropped)
    -- But rates may vary, so we store the raw status change and let admin review

    v_reason := 'confirmation_status_change';

    INSERT INTO public.invoice_adjustments (
      order_id, seller_id, invoice_id,
      old_status, new_status,
      previous_amount, new_amount, difference,
      reason, status
    ) VALUES (
      NEW.order_id, NEW.seller_id, OLD.invoice_id,
      v_old_status, v_new_status,
      0, 0, 0,
      v_reason, 'pending'
    ) RETURNING id INTO v_adj_id;

    -- Log to invoice_history
    INSERT INTO public.invoice_history (
      invoice_id, event_type, field_changed,
      old_value, new_value, order_id, changed_by
    ) VALUES (
      OLD.invoice_id, 'adjustment_created', 'confirmation_status',
      v_old_status, v_new_status,
      NEW.order_id, auth.uid()
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- Recreate the trigger
CREATE TRIGGER trg_invoice_adjustment_on_status_change
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.create_invoice_adjustment_on_status_change();

-- Backend function: approve adjustment
CREATE OR REPLACE FUNCTION public.approve_invoice_adjustment(p_adjustment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_adj public.invoice_adjustments%ROWTYPE;
  v_open_invoice_id uuid;
BEGIN
  -- Auth check
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  -- Get adjustment
  SELECT * INTO v_adj FROM public.invoice_adjustments WHERE id = p_adjustment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Adjustment not found'; END IF;
  IF v_adj.status != 'pending' THEN RAISE EXCEPTION 'Adjustment is not pending'; END IF;

  -- Find seller's current open invoice
  SELECT id INTO v_open_invoice_id
  FROM public.invoices
  WHERE seller_id = v_adj.seller_id AND status = 'open'
  ORDER BY created_at DESC LIMIT 1;

  -- Create one if none exists
  IF v_open_invoice_id IS NULL THEN
    INSERT INTO public.invoices (seller_id, status)
    VALUES (v_adj.seller_id, 'open')
    RETURNING id INTO v_open_invoice_id;
  END IF;

  -- Update adjustment status
  UPDATE public.invoice_adjustments
  SET status = 'approved',
      applied_invoice_id = v_open_invoice_id,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  WHERE id = p_adjustment_id;

  -- Log to invoice_history (on both original and target invoice)
  INSERT INTO public.invoice_history (invoice_id, event_type, field_changed, old_value, new_value, order_id, changed_by)
  VALUES (v_adj.invoice_id, 'adjustment_approved', 'status', 'pending', 'approved', v_adj.order_id, auth.uid());

  INSERT INTO public.invoice_history (invoice_id, event_type, field_changed, old_value, new_value, order_id, changed_by)
  VALUES (v_open_invoice_id, 'adjustment_applied', 'adjustment', NULL, v_adj.difference::text, v_adj.order_id, auth.uid());

  RETURN jsonb_build_object('success', true, 'applied_invoice_id', v_open_invoice_id);
END;
$function$;

-- Backend function: reject adjustment
CREATE OR REPLACE FUNCTION public.reject_invoice_adjustment(p_adjustment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_adj public.invoice_adjustments%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO v_adj FROM public.invoice_adjustments WHERE id = p_adjustment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Adjustment not found'; END IF;
  IF v_adj.status != 'pending' THEN RAISE EXCEPTION 'Adjustment is not pending'; END IF;

  UPDATE public.invoice_adjustments
  SET status = 'rejected',
      reviewed_by = auth.uid(),
      reviewed_at = now()
  WHERE id = p_adjustment_id;

  -- Log to invoice_history
  INSERT INTO public.invoice_history (invoice_id, event_type, field_changed, old_value, new_value, order_id, changed_by)
  VALUES (v_adj.invoice_id, 'adjustment_rejected', 'status', 'pending', 'rejected', v_adj.order_id, auth.uid());

  RETURN jsonb_build_object('success', true);
END;
$function$;
