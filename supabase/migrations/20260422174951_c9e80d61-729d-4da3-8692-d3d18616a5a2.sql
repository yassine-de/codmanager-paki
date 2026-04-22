
CREATE OR REPLACE FUNCTION public.route_order_to_whatsapp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_enabled boolean := false;
BEGIN
  -- Only intervene on default 'new' status; never overwrite an explicit status
  IF NEW.confirmation_status IS DISTINCT FROM 'new' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(p.whatsapp_confirmation_enabled, false)
    INTO v_enabled
  FROM public.products p
  WHERE p.seller_id = NEW.seller_id
    AND p.name = NEW.product_name
  LIMIT 1;

  IF v_enabled THEN
    NEW.confirmation_status := 'new_wts';
    NEW.confirmation_channel := 'whatsapp';
    NEW.whatsapp_status := 'pending';
  END IF;

  RETURN NEW;
END;
$$;

-- BEFORE INSERT, runs before auto_assign_invoice_on_delivery (which is also BEFORE INSERT).
-- Since auto_assign only checks terminal statuses, ordering doesn't matter for invoice logic.
DROP TRIGGER IF EXISTS trg_route_order_to_whatsapp ON public.orders;
CREATE TRIGGER trg_route_order_to_whatsapp
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.route_order_to_whatsapp();
