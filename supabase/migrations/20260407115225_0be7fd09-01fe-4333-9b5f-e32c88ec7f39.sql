
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
  v_has_terminal_event := (
    (NEW.confirmation_status = 'confirmed' AND OLD.confirmation_status IS DISTINCT FROM 'confirmed')
    OR (NEW.confirmation_status = 'cancelled' AND OLD.confirmation_status IS DISTINCT FROM 'cancelled')
    OR (NEW.delivery_status = 'shipped' AND OLD.delivery_status IS DISTINCT FROM 'shipped')
    OR (NEW.delivery_status = 'delivered' AND OLD.delivery_status IS DISTINCT FROM 'delivered')
  );

  IF v_has_terminal_event THEN
    -- If order already has an invoice, check if it's closed
    IF NEW.invoice_id IS NOT NULL THEN
      SELECT status INTO v_current_invoice_status
      FROM public.invoices
      WHERE id = NEW.invoice_id;

      -- IMMUTABILITY: If the invoice is closed (ready/paid), do NOT remove the order.
      -- The adjustment trigger will handle financial corrections separately.
      IF v_current_invoice_status IN ('ready', 'paid') THEN
        RETURN NEW; -- Keep order in closed invoice, do nothing
      END IF;
    END IF;

    -- Only assign to open invoice if order has no invoice yet
    IF NEW.invoice_id IS NULL THEN
      SELECT id INTO v_open_invoice_id
      FROM public.invoices
      WHERE seller_id = NEW.seller_id
        AND status = 'open'
      ORDER BY created_at DESC
      LIMIT 1;

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
