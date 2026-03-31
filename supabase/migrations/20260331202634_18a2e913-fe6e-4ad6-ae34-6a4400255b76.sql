
-- Add weight_kg numeric column to products
ALTER TABLE public.products ADD COLUMN weight_kg numeric DEFAULT NULL;

-- Migrate existing text weight values to numeric
UPDATE public.products SET weight_kg = CASE
  WHEN weight = 'up_to_1kg' THEN 1.0
  WHEN weight = 'up_to_2kg' THEN 2.0
  WHEN weight = 'up_to_3kg' THEN 3.0
  WHEN weight = 'more_than_3kg' THEN 4.0
  ELSE NULL
END WHERE weight IS NOT NULL AND weight != '';

-- Replace the auto_assign_invoice trigger to also handle confirmed/cancelled/shipped orders
CREATE OR REPLACE FUNCTION public.auto_assign_invoice_on_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_draft_invoice_id uuid;
  v_new_invoice_id uuid;
  v_current_invoice_status text;
BEGIN
  -- CASE 1: Order becomes confirmed, shipped, or delivered → assign to draft invoice
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
    
    -- Assign to draft invoice if not already assigned
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
  
  -- CASE 2: Order leaves delivered/shipped AND confirmation is reverted → unassign from draft
  IF OLD.delivery_status IN ('delivered', 'shipped')
     AND NEW.delivery_status IS DISTINCT FROM OLD.delivery_status
     AND NEW.confirmation_status NOT IN ('confirmed', 'cancelled')
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
$function$;
