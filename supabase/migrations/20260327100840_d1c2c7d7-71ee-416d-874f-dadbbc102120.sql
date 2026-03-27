
CREATE OR REPLACE FUNCTION public.auto_assign_invoice_on_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_draft_invoice_id uuid;
  v_new_invoice_id uuid;
  v_current_invoice_status text;
BEGIN
  -- Only act when delivery_status changes TO 'delivered'
  IF NEW.delivery_status = 'delivered' 
     AND (OLD.delivery_status IS DISTINCT FROM 'delivered') THEN
    
    -- Check if current invoice_id points to a non-draft (locked) invoice
    IF NEW.invoice_id IS NOT NULL THEN
      SELECT status INTO v_current_invoice_status
      FROM public.invoices
      WHERE id = NEW.invoice_id;
      
      -- If invoice is locked (ready/paid), detach and reassign
      IF v_current_invoice_status IN ('ready', 'paid') THEN
        NEW.invoice_id := NULL;
      END IF;
    END IF;
    
    -- Only assign if invoice_id is now NULL
    IF NEW.invoice_id IS NULL THEN
      SELECT id INTO v_draft_invoice_id
      FROM public.invoices
      WHERE seller_id = NEW.seller_id
        AND status = 'draft'
      ORDER BY created_at DESC
      LIMIT 1;
      
      IF v_draft_invoice_id IS NOT NULL THEN
        NEW.invoice_id := v_draft_invoice_id;
      ELSE
        INSERT INTO public.invoices (seller_id, status)
        VALUES (NEW.seller_id, 'draft')
        RETURNING id INTO v_new_invoice_id;
        
        NEW.invoice_id := v_new_invoice_id;
      END IF;
    END IF;
  END IF;
  
  -- If order leaves 'delivered' status and invoice is still draft, unassign
  IF OLD.delivery_status = 'delivered' 
     AND NEW.delivery_status IS DISTINCT FROM 'delivered'
     AND NEW.invoice_id IS NOT NULL THEN
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
