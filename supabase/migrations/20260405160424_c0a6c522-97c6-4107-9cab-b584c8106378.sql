
-- Create per-seller invoice counter table
CREATE TABLE IF NOT EXISTS public.seller_invoice_counters (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id uuid NOT NULL UNIQUE,
  current_counter integer NOT NULL DEFAULT 0
);

ALTER TABLE public.seller_invoice_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage invoice counters"
  ON public.seller_invoice_counters FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- Replace the set_invoice_number trigger function to use per-seller numbering with seller prefix
CREATE OR REPLACE FUNCTION public.set_invoice_number()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_prefix text;
  v_counter integer;
BEGIN
  IF NEW.invoice_number = '' OR NEW.invoice_number IS NULL THEN
    -- Get the seller's prefix
    SELECT prefix INTO v_prefix
    FROM seller_order_prefixes
    WHERE seller_id = NEW.seller_id;

    IF v_prefix IS NULL THEN
      v_prefix := 'INV';
    END IF;

    -- Upsert and increment per-seller counter
    INSERT INTO seller_invoice_counters (seller_id, current_counter)
    VALUES (NEW.seller_id, 1)
    ON CONFLICT (seller_id)
    DO UPDATE SET current_counter = seller_invoice_counters.current_counter + 1
    RETURNING current_counter INTO v_counter;

    NEW.invoice_number := v_prefix || '-INV-' || LPAD(v_counter::text, 3, '0');
  END IF;
  RETURN NEW;
END;
$function$;
