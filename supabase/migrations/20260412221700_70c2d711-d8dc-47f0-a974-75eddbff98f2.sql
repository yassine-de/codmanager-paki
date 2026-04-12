CREATE OR REPLACE FUNCTION public.log_invoice_order_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_target_invoice_id uuid;
  v_invoice_status text;
BEGIN
  -- 1. Log invoice_id changes (order moved between invoices)
  IF OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
    IF OLD.invoice_id IS NOT NULL THEN
      INSERT INTO public.invoice_history (
        invoice_id, event_type, field_changed,
        old_value, new_value, order_id, changed_by,
        description, metadata
      ) VALUES (
        OLD.invoice_id, 'order_removed', 'invoice_id',
        OLD.invoice_id::text, COALESCE(NEW.invoice_id::text, 'none'),
        NEW.order_id, auth.uid(),
        'Order ' || NEW.order_id || ' removed from invoice',
        jsonb_build_object(
          'product_name', NEW.product_name,
          'quantity', NEW.quantity,
          'price', NEW.price,
          'confirmation_status', NEW.confirmation_status,
          'delivery_status', COALESCE(NEW.delivery_status, 'none')
        )
      );
    END IF;

    IF NEW.invoice_id IS NOT NULL THEN
      INSERT INTO public.invoice_history (
        invoice_id, event_type, field_changed,
        old_value, new_value, order_id, changed_by,
        description, metadata
      ) VALUES (
        NEW.invoice_id, 'order_added', 'invoice_id',
        COALESCE(OLD.invoice_id::text, 'none'), NEW.invoice_id::text,
        NEW.order_id, auth.uid(),
        'Order ' || NEW.order_id || ' added to invoice',
        jsonb_build_object(
          'product_name', NEW.product_name,
          'quantity', NEW.quantity,
          'price', NEW.price,
          'total_amount', NEW.price * NEW.quantity,
          'confirmation_status', NEW.confirmation_status,
          'delivery_status', COALESCE(NEW.delivery_status, 'none')
        )
      );
    END IF;
  END IF;

  -- 2. Log delivery_status changes
  IF NEW.invoice_id IS NOT NULL 
     AND OLD.invoice_id IS NOT DISTINCT FROM NEW.invoice_id
     AND OLD.delivery_status IS DISTINCT FROM NEW.delivery_status THEN
    
    -- Determine target invoice: if order's invoice is closed, log to current open invoice
    v_target_invoice_id := NEW.invoice_id;
    SELECT status INTO v_invoice_status FROM public.invoices WHERE id = NEW.invoice_id;
    
    IF v_invoice_status IN ('ready', 'paid') THEN
      -- Find the current open invoice for this seller
      SELECT id INTO v_target_invoice_id
      FROM public.invoices
      WHERE seller_id = NEW.seller_id AND status = 'open'
      ORDER BY created_at DESC
      LIMIT 1;
      
      -- If no open invoice found, fall back to the order's invoice
      IF v_target_invoice_id IS NULL THEN
        v_target_invoice_id := NEW.invoice_id;
      END IF;
    END IF;

    -- Order became delivered (IN)
    IF NEW.delivery_status = 'delivered' AND COALESCE(OLD.delivery_status, 'none') != 'delivered' THEN
      INSERT INTO public.invoice_history (
        invoice_id, event_type, field_changed,
        old_value, new_value, order_id, changed_by,
        description, metadata
      ) VALUES (
        v_target_invoice_id, 'delivery_in', 'delivery_status',
        COALESCE(OLD.delivery_status, 'none'), 'delivered',
        NEW.order_id, auth.uid(),
        'Order ' || NEW.order_id || ' delivered',
        jsonb_build_object(
          'product_name', NEW.product_name,
          'quantity', NEW.quantity,
          'price', NEW.price,
          'total_amount', NEW.price * NEW.quantity
        )
      );
    END IF;

    -- Order left delivered (OUT)
    IF OLD.delivery_status = 'delivered' AND COALESCE(NEW.delivery_status, 'none') != 'delivered' THEN
      INSERT INTO public.invoice_history (
        invoice_id, event_type, field_changed,
        old_value, new_value, order_id, changed_by,
        description, metadata
      ) VALUES (
        v_target_invoice_id, 'delivery_out', 'delivery_status',
        'delivered', COALESCE(NEW.delivery_status, 'none'),
        NEW.order_id, auth.uid(),
        'Order ' || NEW.order_id || ' no longer delivered (' || COALESCE(NEW.delivery_status, 'none') || ')',
        jsonb_build_object(
          'product_name', NEW.product_name,
          'quantity', NEW.quantity,
          'price', NEW.price,
          'total_amount', NEW.price * NEW.quantity
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;