CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'whatsapp-ai-sweeper') THEN
    PERFORM cron.unschedule('whatsapp-ai-sweeper');
  END IF;
  PERFORM cron.schedule(
    'whatsapp-ai-sweeper',
    '* * * * *',
    $cron$
    SELECT net.http_post(
      url := 'https://gxyxmxzphyepsmecwbfi.supabase.co/functions/v1/whatsapp-webhook?sweep=1',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4eXhteHpwaHllcHNtZWN3YmZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0NzE0NzIsImV4cCI6MjA5MDA0NzQ3Mn0.qpmNibH7OfhREWbxyp7RizGOz2gyVe7Z7rCbQIKOgp8'
      ),
      body := jsonb_build_object('source', 'cron')
    );
    $cron$
  );
END $$;