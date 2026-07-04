-- Scheduled jobs for the new multi-carrier application.
-- Requires a Supabase Vault secret named `scheduler_service_role_key`.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

CREATE OR REPLACE FUNCTION public.invoke_scheduled_edge_function(
  function_name text,
  request_body jsonb DEFAULT '{}'::jsonb,
  query_string text DEFAULT ''
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  project_url text := 'https://miyzjhjcyowkttdszxit.supabase.co';
  service_key text;
  request_id bigint;
  target_url text;
BEGIN
  SELECT decrypted_secret
    INTO service_key
  FROM vault.decrypted_secrets
  WHERE name = 'scheduler_service_role_key'
  LIMIT 1;

  IF service_key IS NULL OR service_key = '' THEN
    RAISE EXCEPTION 'Missing Vault secret scheduler_service_role_key';
  END IF;

  target_url := project_url || '/functions/v1/' || function_name || COALESCE(query_string, '');

  SELECT net.http_post(
    url := target_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := COALESCE(request_body, '{}'::jsonb)
  )
  INTO request_id;

  RETURN request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_scheduled_edge_function(text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_scheduled_edge_function(text, jsonb, text) TO postgres, service_role;

DO $$
DECLARE
  job_name text;
BEGIN
  FOREACH job_name IN ARRAY ARRAY[
    'carrier-shipping-retry',
    'carrier-status-sync',
    'whatsapp-automation-runner-tick',
    'whatsapp-campaign-scheduler',
    'whatsapp-ai-sweeper'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = job_name) THEN
      PERFORM cron.unschedule(job_name);
    END IF;
  END LOOP;
END $$;

SELECT cron.schedule(
  'carrier-shipping-retry',
  '*/5 * * * *',
  $$SELECT public.invoke_scheduled_edge_function('shipping-sync-retry', '{}'::jsonb);$$
);

SELECT cron.schedule(
  'carrier-status-sync',
  '*/5 * * * *',
  $$SELECT public.invoke_scheduled_edge_function('carrier-status-sync', '{}'::jsonb);$$
);

SELECT cron.schedule(
  'whatsapp-automation-runner-tick',
  '* * * * *',
  $$SELECT public.invoke_scheduled_edge_function('whatsapp-automation-runner', '{"tick": true}'::jsonb);$$
);

SELECT cron.schedule(
  'whatsapp-campaign-scheduler',
  '* * * * *',
  $$SELECT public.invoke_scheduled_edge_function('campaign-runner', '{"action": "process_scheduled"}'::jsonb);$$
);

SELECT cron.schedule(
  'whatsapp-ai-sweeper',
  '* * * * *',
  $$SELECT public.invoke_scheduled_edge_function('whatsapp-webhook', '{"source": "cron"}'::jsonb, '?sweep=1');$$
);
