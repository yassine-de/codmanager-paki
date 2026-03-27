
-- Trigger function: when order delivery_status becomes 'delivered', 
-- auto-assign it to an existing draft invoice or create a new one
CREATE OR REPLACE FUNCTION public.auto_assign_invoice_on_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_draft_invoice_id uuid;
  v_new_invoice_id uuid;
BEGIN
  -- Only act when delivery_status changes TO 'delivered'
  IF NEW.delivery_status = 'delivered' 
     AND (OLD.delivery_status IS DISTINCT FROM 'delivered')
     AND NEW.invoice_id IS NULL THEN
    
    -- Check if there's an existing draft invoice for this seller
    SELECT id INTO v_draft_invoice_id
    FROM public.invoices
    WHERE seller_id = NEW.seller_id
      AND status = 'draft'
    ORDER BY created_at DESC
    LIMIT 1;
    
    IF v_draft_invoice_id IS NOT NULL THEN
      -- Assign order to existing draft invoice
      NEW.invoice_id := v_draft_invoice_id;
    ELSE
      -- Create a new draft invoice for this seller
      INSERT INTO public.invoices (seller_id, status)
      VALUES (NEW.seller_id, 'draft')
      RETURNING id INTO v_new_invoice_id;
      
      NEW.invoice_id := v_new_invoice_id;
    END IF;
  END IF;
  
  -- If order leaves 'delivered' status and invoice is still draft, unassign
  IF OLD.delivery_status = 'delivered' 
     AND NEW.delivery_status IS DISTINCT FROM 'delivered'
     AND NEW.invoice_id IS NOT NULL THEN
    -- Only unassign if the invoice is still in draft
    IF EXISTS (
      SELECT 1 FROM public.invoices 
      WHERE id = NEW.invoice_id AND status = 'draft'
    ) THEN
      NEW.invoice_id := NULL;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create the trigger
CREATE TRIGGER trg_auto_assign_invoice
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_invoice_on_delivery();
