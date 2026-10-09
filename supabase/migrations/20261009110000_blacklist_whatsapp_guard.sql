-- Blacklisted customers must always go through an agent (who sees the blacklist
-- warning), never get confirmed by WhatsApp automation. Enforced as a BEFORE
-- trigger so it covers every path at once: sheet import, manual create, inbox
-- "send to WhatsApp", button/AI confirmations in whatsapp-webhook and the inbox
-- "confirm" action.
-- Same rule as get_customer_blacklist_status: manual 'blacklisted' wins, manual
-- 'cleared' wins, else >= 2 returned orders and 0 delivered.
CREATE OR REPLACE FUNCTION public.is_customer_blacklisted(p_phone text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH k AS (SELECT public.normalize_phone_key(p_phone) AS key)
  SELECT CASE
    WHEN coalesce((SELECT key FROM k), '') = '' THEN false
    WHEN EXISTS (SELECT 1 FROM public.customer_blacklist b WHERE b.phone_key = (SELECT key FROM k) AND b.status = 'blacklisted') THEN true
    WHEN EXISTS (SELECT 1 FROM public.customer_blacklist b WHERE b.phone_key = (SELECT key FROM k) AND b.status = 'cleared') THEN false
    ELSE (
      SELECT count(*) FILTER (WHERE o.delivery_status IN ('return', 'returned', 'ready_for_return', 'return_received')) >= 2
         AND count(*) FILTER (WHERE o.delivery_status IN ('delivered', 'paid')) = 0
      FROM public.orders o
      WHERE o.customer_phone_normalized = (SELECT key FROM k)
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.is_customer_blacklisted(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.route_blacklisted_orders_off_whatsapp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entering boolean;
  v_confirming boolean;
  v_old_channel text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_entering := NEW.confirmation_channel = 'whatsapp' AND NEW.confirmation_status IN ('new_wts', 'pending_address');
    v_confirming := NEW.confirmation_channel = 'whatsapp' AND NEW.confirmation_status = 'confirmed';
  ELSE
    v_entering := NEW.confirmation_channel = 'whatsapp'
      AND NEW.confirmation_status IN ('new_wts', 'pending_address')
      AND NOT (OLD.confirmation_channel = 'whatsapp' AND OLD.confirmation_status IN ('new_wts', 'pending_address'));
    v_confirming := NEW.confirmation_channel = 'whatsapp'
      AND NEW.confirmation_status = 'confirmed'
      AND OLD.confirmation_status IS DISTINCT FROM 'confirmed';
  END IF;

  IF NOT (coalesce(v_entering, false) OR coalesce(v_confirming, false)) THEN
    RETURN NEW;
  END IF;
  IF NOT public.is_customer_blacklisted(NEW.customer_phone) THEN
    RETURN NEW;
  END IF;

  v_old_channel := CASE WHEN TG_OP = 'UPDATE' THEN OLD.confirmation_channel ELSE 'whatsapp' END;

  IF TG_OP = 'UPDATE' AND OLD.confirmation_status NOT IN ('new_wts', 'pending_address') THEN
    -- Already in the agent flow (new / no_answer / postponed ...): keep it exactly there.
    NEW.confirmation_status := OLD.confirmation_status;
    NEW.confirmation_channel := OLD.confirmation_channel;
  ELSE
    NEW.confirmation_status := 'new';
    NEW.confirmation_channel := 'agent';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.confirmed_at := OLD.confirmed_at;
    -- Undo WhatsApp auto-booking (auto_book_shipping sets these in the same update).
    NEW.delivery_status := OLD.delivery_status;
    NEW.shipping_status := OLD.shipping_status;
  ELSE
    NEW.confirmed_at := NULL;
  END IF;

  NEW.whatsapp_status := 'handed_to_agent';
  NEW.whatsapp_note := 'Blacklisted customer: sent to an agent instead of WhatsApp confirmation';

  INSERT INTO public.order_history (order_id, changed_by, changed_by_role, field_changed, old_value, new_value, action_type)
  VALUES (NEW.order_id, NULL, 'system', 'confirmation_channel', v_old_channel, NEW.confirmation_channel, 'blacklist_whatsapp_block');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_blacklist_whatsapp_guard ON public.orders;
CREATE TRIGGER orders_blacklist_whatsapp_guard
  BEFORE INSERT OR UPDATE OF confirmation_status, confirmation_channel ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.route_blacklisted_orders_off_whatsapp();
