-- 1. Trigger: log delivery_status changes to order_history automatically
-- This ensures ORIO Edge Function status updates are tracked for invoice calculations

CREATE OR REPLACE FUNCTION public.log_delivery_status_change_to_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_changed_by uuid;
  v_role text;
BEGIN
  -- Only fire when delivery_status actually changes
  IF NEW.delivery_status IS DISTINCT FROM OLD.delivery_status THEN
    -- Detect change source: auth.uid() if user, else system (NULL/zero uuid)
    v_changed_by := COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
    v_role := CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END;

    -- Avoid duplicate insert if app-code already logged this exact change in last 5s
    IF NOT EXISTS (
      SELECT 1 FROM public.order_history
      WHERE order_id = NEW.order_id
        AND field_changed = 'delivery_status'
        AND new_value = COALESCE(NEW.delivery_status, '')
        AND created_at > now() - interval '5 seconds'
    ) THEN
      INSERT INTO public.order_history (
        order_id, field_changed, old_value, new_value,
        changed_by, changed_by_role, action_type, created_at
      ) VALUES (
        NEW.order_id,
        'delivery_status',
        COALESCE(OLD.delivery_status, ''),
        COALESCE(NEW.delivery_status, ''),
        v_changed_by,
        v_role,
        'auto_sync',
        now()
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_delivery_status_history ON public.orders;
CREATE TRIGGER trg_log_delivery_status_history
AFTER UPDATE OF delivery_status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.log_delivery_status_change_to_history();

-- 2. BACKFILL: insert missing order_history rows for orders already in
-- non-default delivery states without a corresponding history entry.
-- Use orio_synced_at when available, else updated_at.
INSERT INTO public.order_history (
  order_id, field_changed, old_value, new_value,
  changed_by, changed_by_role, action_type, created_at
)
SELECT
  o.order_id,
  'delivery_status',
  '',
  o.delivery_status,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'system',
  'backfill',
  COALESCE(o.orio_synced_at, o.updated_at)
FROM public.orders o
WHERE o.delivery_status IN ('shipped','in_transit','with_courier','delivered','returned','cancelled','failed','booked')
  AND NOT EXISTS (
    SELECT 1 FROM public.order_history oh
    WHERE oh.order_id = o.order_id
      AND oh.field_changed = 'delivery_status'
      AND oh.new_value = o.delivery_status
  );
