-- Trigger: when a new order is inserted, check if a confirmed order already exists
-- for the same customer_phone + product_name. If so, send a WhatsApp notification
-- into the new order's conversation so whoever is handling it sees the duplicate.

CREATE OR REPLACE FUNCTION public.trigger_duplicate_order_whatsapp_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url     text;
  v_anon    text;
  v_dup_ids text[];
  v_msg     text;
BEGIN
  -- Read project URL + anon key from app_settings
  SELECT value INTO v_url  FROM public.app_settings WHERE key = 'project_url'      LIMIT 1;
  SELECT value INTO v_anon FROM public.app_settings WHERE key = 'project_anon_key' LIMIT 1;

  IF v_url IS NULL OR v_anon IS NULL THEN
    RETURN NEW;
  END IF;

  -- Find any existing order for the same phone + product (any status, excluding this row)
  SELECT array_agg(order_id ORDER BY created_at DESC)
  INTO   v_dup_ids
  FROM   public.orders
  WHERE  customer_phone = NEW.customer_phone
    AND  product_name   = NEW.product_name
    AND  id            != NEW.id;

  -- Nothing found → no alert needed
  IF v_dup_ids IS NULL OR array_length(v_dup_ids, 1) = 0 THEN
    RETURN NEW;
  END IF;

  -- Build the alert message
  v_msg := '⚠️ Duplicate order detected. This customer already has an existing order for the same product: '
           || array_to_string(v_dup_ids, ', ')
           || '. Please verify before proceeding.';

  -- Fire-and-forget: send a text message into this order's WhatsApp conversation
  PERFORM net.http_post(
    url     := v_url || '/functions/v1/whatsapp-send',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_anon
    ),
    body    := jsonb_build_object(
      'order_id', NEW.order_id,
      'mode',     'text',
      'body',     v_msg
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the insert — silently swallow errors
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_duplicate_order_whatsapp_alert ON public.orders;
CREATE TRIGGER trg_duplicate_order_whatsapp_alert
  AFTER INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_duplicate_order_whatsapp_alert();
