-- Update the trigger function to also handle INSERT (new orders)
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
  -- CASE 1: New order INSERT — assign to open invoice immediately
  IF TG_OP = 'INSERT' THEN
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
    RETURN NEW;
  END IF;

  -- CASE 2: UPDATE — existing terminal status logic
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
      IF v_current_invoice_status IN ('ready', 'paid') THEN
        RETURN NEW;
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

-- Create the BEFORE trigger on orders for both INSERT and UPDATE
CREATE TRIGGER auto_assign_invoice_trigger
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_invoice_on_delivery();

-- Now assign existing 23 orders to an open invoice
DO $$
DECLARE
  v_seller_id uuid;
  v_open_invoice_id uuid;
BEGIN
  -- Get the seller of existing unlinked orders
  SELECT DISTINCT seller_id INTO v_seller_id
  FROM public.orders
  WHERE invoice_id IS NULL
  LIMIT 1;

  IF v_seller_id IS NOT NULL THEN
    -- Find or create open invoice
    SELECT id INTO v_open_invoice_id
    FROM public.invoices
    WHERE seller_id = v_seller_id AND status = 'open'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_open_invoice_id IS NULL THEN
      INSERT INTO public.invoices (seller_id, status)
      VALUES (v_seller_id, 'open')
      RETURNING id INTO v_open_invoice_id;
    END IF;

    -- Link all unlinked orders
    UPDATE public.orders
    SET invoice_id = v_open_invoice_id
    WHERE seller_id = v_seller_id AND invoice_id IS NULL;
  END IF;
END $$;