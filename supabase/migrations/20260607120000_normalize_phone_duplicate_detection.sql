-- Fix duplicate-order detection (WhatsApp alert + agent claim) by normalizing phone numbers.
--
-- ROOT CAUSE: customer_phone is stored in different formats depending on the source:
--   * Sheets import  → "+923001234567" (with +92)
--   * WhatsApp inbound/outbound → "923001234567" (bare digits) or "03001234567" (legacy local)
-- Duplicate detection compared customer_phone with EXACT match, so the same customer in two
-- different formats was never flagged as a duplicate — neither in the WhatsApp alert trigger
-- nor in the agent-side claim_next_order('duplicate') RPC.
--
-- FIX: compare on a normalized phone key = last 10 digits (the subscriber number, format-agnostic).

-- 1. Helper: normalized phone key (last 10 digits, strips +, country code, leading zero, spaces).
CREATE OR REPLACE FUNCTION public.normalize_phone_key(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10);
$$;

-- 2. Rewrite duplicate-alert trigger to match on normalized phone key.
CREATE OR REPLACE FUNCTION public.trigger_duplicate_order_whatsapp_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url     text;
  v_anon    text;
  v_dup     RECORD;
  v_msg_new text;
  v_msg_old text;
BEGIN
  SELECT value INTO v_url  FROM public.app_settings WHERE key = 'project_url'      LIMIT 1;
  SELECT value INTO v_anon FROM public.app_settings WHERE key = 'project_anon_key' LIMIT 1;

  IF v_url IS NULL OR v_anon IS NULL THEN
    RETURN NEW;
  END IF;

  -- Find all existing orders for the same NORMALIZED phone + product (any status, excluding this row)
  FOR v_dup IN
    SELECT order_id
    FROM   public.orders
    WHERE  public.normalize_phone_key(customer_phone) = public.normalize_phone_key(NEW.customer_phone)
      AND  product_name   = NEW.product_name
      AND  id            != NEW.id
    ORDER BY created_at DESC
  LOOP
    v_msg_new := '⚠️ Duplicate order detected. This customer already has an existing order for the same product: '
               || v_dup.order_id
               || '. Please verify before proceeding.';

    PERFORM net.http_post(
      url     := v_url || '/functions/v1/whatsapp-send',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_anon),
      body    := jsonb_build_object('order_id', NEW.order_id, 'mode', 'note', 'body', v_msg_new)
    );

    v_msg_old := '⚠️ Duplicate order detected. A new order ' || NEW.order_id
               || ' was just created for the same customer and product. Please verify before proceeding.';

    PERFORM net.http_post(
      url     := v_url || '/functions/v1/whatsapp-send',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_anon),
      body    := jsonb_build_object('order_id', v_dup.order_id, 'mode', 'note', 'body', v_msg_old)
    );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_duplicate_order_whatsapp_alert ON public.orders;
CREATE TRIGGER trg_duplicate_order_whatsapp_alert
  AFTER INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_duplicate_order_whatsapp_alert();

-- 3. Rewrite claim_next_order so the 'duplicate' branch groups on the normalized phone key.
CREATE OR REPLACE FUNCTION public.claim_next_order(p_agent_id uuid, p_order_type text DEFAULT 'new', p_product_names text[] DEFAULT NULL)
RETURNS SETOF orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM release_expired_order_locks();

  IF p_order_type = 'new' THEN
    RETURN QUERY
    WITH picked AS (
      SELECT o.id
      FROM orders o
      WHERE o.confirmation_status = 'new'
        AND o.agent_id IS NULL
        AND (p_product_names IS NULL OR o.product_name = ANY(p_product_names))
      ORDER BY o.created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE orders o2
    SET agent_id = p_agent_id, assigned_at = now(), last_activity_at = now(), updated_at = now()
    FROM picked
    WHERE o2.id = picked.id
    RETURNING o2.*;

  ELSIF p_order_type = 'no_answer' THEN
    RETURN QUERY
    WITH picked AS (
      SELECT o.id
      FROM orders o
      WHERE o.confirmation_status = 'no_answer'
        AND o.agent_id IS NULL
        AND o.attempt_count < 12
        AND (o.last_attempt_at IS NULL OR o.last_attempt_at <= now() - interval '30 minutes')
        AND (
          o.last_attempt_date IS DISTINCT FROM CURRENT_DATE
          OR o.attempts_today < 4
        )
        AND (p_product_names IS NULL OR o.product_name = ANY(p_product_names))
      ORDER BY o.last_attempt_at ASC NULLS FIRST
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE orders o2
    SET agent_id = p_agent_id, assigned_at = now(), last_activity_at = now(), updated_at = now()
    FROM picked
    WHERE o2.id = picked.id
    RETURNING o2.*;

  ELSIF p_order_type = 'postponed' THEN
    RETURN QUERY
    WITH picked AS (
      SELECT o.id
      FROM orders o
      WHERE o.confirmation_status = 'postponed'
        AND o.agent_id IS NULL
        AND o.postpone_date <= now()
        AND o.original_agent_id = p_agent_id
        AND (p_product_names IS NULL OR o.product_name = ANY(p_product_names))
      ORDER BY o.postpone_date ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE orders o2
    SET agent_id = p_agent_id, assigned_at = now(), last_activity_at = now(), updated_at = now()
    FROM picked
    WHERE o2.id = picked.id
    RETURNING o2.*;

    IF NOT FOUND THEN
      RETURN QUERY
      WITH picked AS (
        SELECT o.id
        FROM orders o
        WHERE o.confirmation_status = 'postponed'
          AND o.agent_id IS NULL
          AND o.postpone_date <= now()
          AND o.original_agent_id IS DISTINCT FROM p_agent_id
          AND NOT EXISTS (
            SELECT 1 FROM user_presence up
            WHERE up.user_id = o.original_agent_id
              AND up.is_active = true
              AND up.last_seen > now() - interval '10 minutes'
          )
          AND (p_product_names IS NULL OR o.product_name = ANY(p_product_names))
        ORDER BY o.postpone_date ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE orders o2
      SET agent_id = p_agent_id, assigned_at = now(), last_activity_at = now(), updated_at = now()
      FROM picked
      WHERE o2.id = picked.id
      RETURNING o2.*;
    END IF;

  ELSIF p_order_type = 'duplicate' THEN
    RETURN QUERY
    WITH first_dup AS (
      SELECT public.normalize_phone_key(o.customer_phone) AS phone_key, o.product_name
      FROM orders o
      WHERE o.confirmation_status = 'new'
        AND o.agent_id IS NULL
        AND (p_product_names IS NULL OR o.product_name = ANY(p_product_names))
      GROUP BY public.normalize_phone_key(o.customer_phone), o.product_name
      HAVING COUNT(*) > 1
      LIMIT 1
    ),
    picked AS (
      SELECT o.id
      FROM orders o
      INNER JOIN first_dup fd
        ON public.normalize_phone_key(o.customer_phone) = fd.phone_key
       AND o.product_name = fd.product_name
      WHERE o.confirmation_status = 'new'
        AND o.agent_id IS NULL
      FOR UPDATE SKIP LOCKED
    )
    UPDATE orders o2
    SET agent_id = p_agent_id, assigned_at = now(), last_activity_at = now(), updated_at = now()
    FROM picked
    WHERE o2.id = picked.id
    RETURNING o2.*;
  END IF;
END;
$$;

-- 4. Rewrite resolve_duplicate_group to mark duplicates on the normalized phone key too.
CREATE OR REPLACE FUNCTION public.resolve_duplicate_group(
  p_valid_order_id uuid,
  p_agent_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_phone text;
  v_product text;
BEGIN
  SELECT customer_phone, product_name INTO v_phone, v_product
  FROM orders
  WHERE id = p_valid_order_id AND agent_id = p_agent_id;

  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'Order not found or not assigned to this agent';
  END IF;

  UPDATE orders
  SET confirmation_status = 'double',
      note = 'Duplicate of ' || (SELECT order_id FROM orders WHERE id = p_valid_order_id),
      updated_at = now()
  WHERE agent_id = p_agent_id
    AND public.normalize_phone_key(customer_phone) = public.normalize_phone_key(v_phone)
    AND product_name = v_product
    AND id != p_valid_order_id
    AND confirmation_status = 'new';
END;
$function$;

NOTIFY pgrst, 'reload schema';
