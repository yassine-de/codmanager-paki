
-- 1. Rename 'draft' status to 'open' in all existing invoices
UPDATE public.invoices SET status = 'open' WHERE status = 'draft';

-- 2. Add previous_balance column to invoices
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS previous_balance numeric NOT NULL DEFAULT 0;

-- 3. Recreate auto_assign_invoice_on_delivery with 'open' instead of 'draft'
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
BEGIN
  -- CASE 1: Order reaches a terminal state → assign to open invoice
  IF (
    (NEW.confirmation_status = 'confirmed' AND OLD.confirmation_status IS DISTINCT FROM 'confirmed')
    OR (NEW.delivery_status = 'shipped' AND (OLD.delivery_status IS DISTINCT FROM 'shipped'))
    OR (NEW.delivery_status = 'delivered' AND (OLD.delivery_status IS DISTINCT FROM 'delivered'))
    OR (NEW.confirmation_status = 'cancelled' AND OLD.confirmation_status IS DISTINCT FROM 'cancelled')
  ) THEN
    -- Check if current invoice is locked
    IF NEW.invoice_id IS NOT NULL THEN
      SELECT status INTO v_current_invoice_status
      FROM public.invoices
      WHERE id = NEW.invoice_id;
      
      IF v_current_invoice_status IN ('ready', 'paid') THEN
        NEW.invoice_id := NULL;
      END IF;
    END IF;
    
    -- Assign to open invoice if not already assigned
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
  
  -- CASE 2: Order leaves delivered/shipped AND confirmation is reverted → unassign from open
  IF OLD.delivery_status IN ('delivered', 'shipped')
     AND NEW.delivery_status IS DISTINCT FROM OLD.delivery_status
     AND NEW.confirmation_status NOT IN ('confirmed', 'cancelled')
     AND NEW.invoice_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.invoices 
      WHERE id = NEW.invoice_id AND status = 'open'
    ) THEN
      NEW.invoice_id := NULL;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$;
