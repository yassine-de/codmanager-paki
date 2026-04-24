-- 1) Add tracking columns
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS agent_switch_scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS agent_switched_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_orders_agent_switch_scheduled
  ON public.orders (agent_switch_scheduled_at)
  WHERE agent_switch_scheduled_at IS NOT NULL
    AND confirmation_status = 'new_wts';

-- 2) RPC that performs the switch
CREATE OR REPLACE FUNCTION public.process_agent_switch_timeouts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH eligible AS (
    SELECT o.order_id
    FROM public.orders o
    LEFT JOIN public.whatsapp_conversations c
      ON c.order_id = o.order_id
    WHERE o.confirmation_status = 'new_wts'
      AND o.agent_switch_scheduled_at IS NOT NULL
      AND o.agent_switch_scheduled_at <= now()
      AND o.agent_switched_at IS NULL
      -- Customer never replied (no last_reply_at on the conversation)
      AND (c.id IS NULL OR c.last_reply_at IS NULL)
  ), updated AS (
    UPDATE public.orders o
       SET confirmation_status = 'new',
           confirmation_channel = 'agent',
           agent_switched_at = now(),
           updated_at = now()
      FROM eligible e
     WHERE o.order_id = e.order_id
     RETURNING o.order_id
  )
  SELECT count(*) INTO v_count FROM updated;
  RETURN v_count;
END;
$$;

-- 3) pg_cron schedule (every minute)
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-agent-switch-timeouts') THEN
    PERFORM cron.unschedule('process-agent-switch-timeouts');
  END IF;
  PERFORM cron.schedule(
    'process-agent-switch-timeouts',
    '* * * * *',
    $cron$ SELECT public.process_agent_switch_timeouts(); $cron$
  );
END $$;