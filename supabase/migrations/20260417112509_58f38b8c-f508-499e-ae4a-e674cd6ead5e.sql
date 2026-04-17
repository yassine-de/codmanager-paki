-- 1. Create agent_activity_log table
CREATE TABLE public.agent_activity_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID NOT NULL,
  activity_type TEXT NOT NULL,
  order_id TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 2. Indexes for fast queries
CREATE INDEX idx_agent_activity_agent_created ON public.agent_activity_log(agent_id, created_at DESC);
CREATE INDEX idx_agent_activity_created ON public.agent_activity_log(created_at DESC);
CREATE INDEX idx_agent_activity_type ON public.agent_activity_log(activity_type);

-- 3. Enable RLS
ALTER TABLE public.agent_activity_log ENABLE ROW LEVEL SECURITY;

-- 4. Only Admins can view; system inserts via trigger (SECURITY DEFINER)
CREATE POLICY "Admins full access agent_activity_log"
ON public.agent_activity_log
FOR ALL
TO authenticated
USING (is_admin(auth.uid()))
WITH CHECK (is_admin(auth.uid()));

-- 5. Trigger function: log agent actions on orders
CREATE OR REPLACE FUNCTION public.log_agent_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent_id UUID;
  v_activity TEXT;
  v_meta JSONB := '{}'::jsonb;
BEGIN
  -- Determine which agent performed the action
  v_agent_id := COALESCE(NEW.agent_id, OLD.agent_id, NEW.original_agent_id);

  -- Only log if an agent is involved and is the auth user (avoid admin/seller noise)
  IF v_agent_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Skip if the action is not performed by the agent themselves
  IF auth.uid() IS DISTINCT FROM v_agent_id THEN
    RETURN NEW;
  END IF;

  -- Detect activity type
  IF TG_OP = 'INSERT' THEN
    v_activity := 'claim';
  ELSIF OLD.confirmation_status IS DISTINCT FROM NEW.confirmation_status THEN
    v_activity := 'confirmation_' || NEW.confirmation_status;
    v_meta := jsonb_build_object('from', OLD.confirmation_status, 'to', NEW.confirmation_status);
  ELSIF OLD.delivery_status IS DISTINCT FROM NEW.delivery_status THEN
    v_activity := 'delivery_' || COALESCE(NEW.delivery_status, 'null');
    v_meta := jsonb_build_object('from', OLD.delivery_status, 'to', NEW.delivery_status);
  ELSIF OLD.shipping_status IS DISTINCT FROM NEW.shipping_status THEN
    v_activity := 'shipping_' || COALESCE(NEW.shipping_status, 'null');
    v_meta := jsonb_build_object('from', OLD.shipping_status, 'to', NEW.shipping_status);
  ELSIF OLD.note IS DISTINCT FROM NEW.note THEN
    v_activity := 'edit_note';
  ELSIF OLD.postpone_date IS DISTINCT FROM NEW.postpone_date THEN
    v_activity := 'reschedule';
    v_meta := jsonb_build_object('postpone_date', NEW.postpone_date);
  ELSIF OLD.total_amount IS DISTINCT FROM NEW.total_amount OR OLD.price IS DISTINCT FROM NEW.price THEN
    v_activity := 'edit_price';
  ELSE
    v_activity := 'edit_other';
  END IF;

  INSERT INTO public.agent_activity_log (agent_id, activity_type, order_id, metadata)
  VALUES (v_agent_id, v_activity, NEW.order_id, v_meta);

  RETURN NEW;
END;
$$;

-- 6. Attach trigger to orders table
DROP TRIGGER IF EXISTS trg_log_agent_activity ON public.orders;
CREATE TRIGGER trg_log_agent_activity
AFTER INSERT OR UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.log_agent_activity();

-- 7. Cleanup function — only deletes from agent_activity_log
CREATE OR REPLACE FUNCTION public.cleanup_agent_activity_log()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.agent_activity_log
  WHERE created_at < (now() - interval '30 days');
END;
$$;