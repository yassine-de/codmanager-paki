
-- 1. Add is_custom column to rate_settings
ALTER TABLE public.rate_settings ADD COLUMN IF NOT EXISTS is_custom boolean NOT NULL DEFAULT false;

-- 2. Create function to propagate global rates to non-custom sellers
CREATE OR REPLACE FUNCTION public.propagate_global_rates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only propagate when the global record is updated
  IF NEW.seller_id IS NULL AND NEW.is_global = true THEN
    UPDATE rate_settings
    SET
      dropped_order_rate = NEW.dropped_order_rate,
      confirmed_order_rate = NEW.confirmed_order_rate,
      shipping_rate_1kg = NEW.shipping_rate_1kg,
      shipping_rate_2kg = NEW.shipping_rate_2kg,
      shipping_rate_3kg = NEW.shipping_rate_3kg,
      cod_fee_per_delivery = NEW.cod_fee_per_delivery,
      updated_at = now()
    WHERE is_custom = false AND seller_id IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Create trigger on rate_settings for global propagation
DROP TRIGGER IF EXISTS trg_propagate_global_rates ON public.rate_settings;
CREATE TRIGGER trg_propagate_global_rates
  AFTER UPDATE ON public.rate_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.propagate_global_rates();

-- 4. Create function to auto-create seller rates from global when a new seller role is added
CREATE OR REPLACE FUNCTION public.create_seller_rates_on_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_global rate_settings%ROWTYPE;
BEGIN
  IF NEW.role = 'seller' THEN
    -- Get global rates
    SELECT * INTO v_global FROM rate_settings WHERE seller_id IS NULL AND is_global = true LIMIT 1;
    
    -- Only create if seller doesn't already have rates
    IF NOT EXISTS (SELECT 1 FROM rate_settings WHERE seller_id = NEW.user_id) THEN
      INSERT INTO rate_settings (
        seller_id, is_global, is_custom,
        dropped_order_rate, confirmed_order_rate,
        shipping_rate_1kg, shipping_rate_2kg, shipping_rate_3kg,
        cod_fee_per_delivery, agent_commission_confirmed, agent_commission_delivered
      ) VALUES (
        NEW.user_id, false, false,
        COALESCE(v_global.dropped_order_rate, 0),
        COALESCE(v_global.confirmed_order_rate, 0),
        COALESCE(v_global.shipping_rate_1kg, 0),
        COALESCE(v_global.shipping_rate_2kg, 0),
        COALESCE(v_global.shipping_rate_3kg, 0),
        COALESCE(v_global.cod_fee_per_delivery, 0),
        0, 0
      );
    END IF;
    
    -- Also create seller_rates record (used by invoices for shipping)
    IF NOT EXISTS (SELECT 1 FROM seller_rates WHERE user_id = NEW.user_id) THEN
      INSERT INTO seller_rates (user_id, rate_1kg, rate_2kg, rate_3kg, rate_3kg_plus)
      VALUES (
        NEW.user_id,
        COALESCE(v_global.shipping_rate_1kg, 0),
        COALESCE(v_global.shipping_rate_2kg, 0),
        COALESCE(v_global.shipping_rate_3kg, 0),
        0
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 5. Create trigger on user_roles for new sellers
DROP TRIGGER IF EXISTS trg_create_seller_rates ON public.user_roles;
CREATE TRIGGER trg_create_seller_rates
  AFTER INSERT ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.create_seller_rates_on_role();

-- 6. Also sync seller_rates table when rate_settings shipping rates change
CREATE OR REPLACE FUNCTION public.sync_seller_rates_from_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.seller_id IS NOT NULL THEN
    INSERT INTO seller_rates (user_id, rate_1kg, rate_2kg, rate_3kg)
    VALUES (NEW.seller_id, NEW.shipping_rate_1kg, NEW.shipping_rate_2kg, NEW.shipping_rate_3kg)
    ON CONFLICT (user_id) DO UPDATE SET
      rate_1kg = EXCLUDED.rate_1kg,
      rate_2kg = EXCLUDED.rate_2kg,
      rate_3kg = EXCLUDED.rate_3kg;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_seller_rates ON public.rate_settings;
CREATE TRIGGER trg_sync_seller_rates
  AFTER INSERT OR UPDATE ON public.rate_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_seller_rates_from_settings();

-- 7. Backfill: create rate_settings for existing sellers who don't have one
INSERT INTO rate_settings (seller_id, is_global, is_custom, dropped_order_rate, confirmed_order_rate, shipping_rate_1kg, shipping_rate_2kg, shipping_rate_3kg, cod_fee_per_delivery, agent_commission_confirmed, agent_commission_delivered)
SELECT 
  ur.user_id, false, false,
  COALESCE(g.dropped_order_rate, 0),
  COALESCE(g.confirmed_order_rate, 0),
  COALESCE(g.shipping_rate_1kg, 0),
  COALESCE(g.shipping_rate_2kg, 0),
  COALESCE(g.shipping_rate_3kg, 0),
  COALESCE(g.cod_fee_per_delivery, 0),
  0, 0
FROM user_roles ur
LEFT JOIN rate_settings g ON g.seller_id IS NULL AND g.is_global = true
WHERE ur.role = 'seller'
  AND NOT EXISTS (SELECT 1 FROM rate_settings rs WHERE rs.seller_id = ur.user_id)
ON CONFLICT DO NOTHING;
