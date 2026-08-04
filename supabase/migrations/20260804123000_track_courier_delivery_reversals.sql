-- Surface courier reversals after a parcel was previously delivered.
-- Example: PostEx marks an order delivered, then later returns it to merchant.

CREATE OR REPLACE FUNCTION public.create_courier_delivery_reversal_adjustment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old_status text := COALESCE(OLD.delivery_status, 'none');
  v_new_status text := COALESCE(NEW.delivery_status, 'none');
  v_previous_amount numeric := COALESCE(OLD.price, 0) * COALESCE(OLD.quantity, 1);
BEGIN
  IF OLD.delivery_status IS NOT DISTINCT FROM NEW.delivery_status THEN
    RETURN NEW;
  END IF;

  IF COALESCE(OLD.delivery_status, '') != 'delivered' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.delivery_status, 'none') IN ('delivered', 'paid') THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.payment_status, '') = 'paid' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.shipping_company, OLD.shipping_company, '') = ''
     AND COALESCE(NEW.shipping_status, OLD.shipping_status, '') = '' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invoice_adjustments ia
    WHERE ia.order_id = NEW.order_id
      AND ia.reason = 'courier_delivery_reversal'
      AND ia.status = 'pending'
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.invoice_adjustments (
    order_id, seller_id, invoice_id,
    old_status, new_status,
    previous_amount, new_amount, difference,
    previous_shipping_fee, new_shipping_fee, shipping_difference,
    reason, status
  ) VALUES (
    NEW.order_id, NEW.seller_id, OLD.invoice_id,
    v_old_status, v_new_status,
    v_previous_amount, 0, -v_previous_amount,
    0, 0, 0,
    'courier_delivery_reversal', 'pending'
  );

  IF OLD.invoice_id IS NOT NULL THEN
    INSERT INTO public.invoice_history (
      invoice_id, event_type, field_changed,
      old_value, new_value, order_id, changed_by, description
    ) VALUES (
      OLD.invoice_id, 'adjustment_created', 'delivery_status',
      v_old_status, v_new_status, NEW.order_id, auth.uid(),
      'Courier changed a previously delivered order to a non-paid status'
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_courier_delivery_reversal_adjustment ON public.orders;
CREATE TRIGGER trg_courier_delivery_reversal_adjustment
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.create_courier_delivery_reversal_adjustment();

-- Backfill current records that already have this problem, such as delivered_at set
-- while the current delivery status is returned/return/failed/etc.
INSERT INTO public.invoice_adjustments (
  order_id, seller_id, invoice_id,
  old_status, new_status,
  previous_amount, new_amount, difference,
  previous_shipping_fee, new_shipping_fee, shipping_difference,
  reason, status
)
SELECT
  o.order_id,
  o.seller_id,
  o.invoice_id,
  'delivered',
  COALESCE(o.delivery_status, 'none'),
  COALESCE(o.price, 0) * COALESCE(o.quantity, 1),
  0,
  -(COALESCE(o.price, 0) * COALESCE(o.quantity, 1)),
  0,
  0,
  0,
  'courier_delivery_reversal',
  'pending'
FROM public.orders o
WHERE o.delivered_at IS NOT NULL
  AND COALESCE(o.delivery_status, 'none') NOT IN ('delivered', 'paid')
  AND COALESCE(o.payment_status, '') != 'paid'
  AND (COALESCE(o.shipping_company, '') != '' OR COALESCE(o.shipping_status, '') != '')
  AND NOT EXISTS (
    SELECT 1
    FROM public.invoice_adjustments ia
    WHERE ia.order_id = o.order_id
      AND ia.reason = 'courier_delivery_reversal'
      AND ia.status = 'pending'
  );

UPDATE public.orders
SET delivered_at = NULL,
    updated_at = now()
WHERE delivered_at IS NOT NULL
  AND COALESCE(delivery_status, 'none') NOT IN ('delivered', 'paid')
  AND COALESCE(payment_status, '') != 'paid'
  AND (COALESCE(shipping_company, '') != '' OR COALESCE(shipping_status, '') != '');
