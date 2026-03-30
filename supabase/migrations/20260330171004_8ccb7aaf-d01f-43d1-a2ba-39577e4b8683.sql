
-- Add active column to products (default false)
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT false;

-- Set existing products as active if they have both product_url and video_url
UPDATE public.products 
SET active = true 
WHERE product_url IS NOT NULL AND product_url != '' 
  AND video_url IS NOT NULL AND video_url != '';

-- Create trigger to auto-set active based on URLs
CREATE OR REPLACE FUNCTION public.update_product_active_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.product_url IS NOT NULL AND NEW.product_url != '' 
     AND NEW.video_url IS NOT NULL AND NEW.video_url != '' THEN
    NEW.active := true;
  ELSE
    NEW.active := false;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_update_product_active
BEFORE INSERT OR UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.update_product_active_status();
