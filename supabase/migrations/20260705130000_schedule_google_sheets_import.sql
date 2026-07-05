DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'google-sheets-import'
  ) THEN
    PERFORM cron.schedule(
      'google-sheets-import',
      '*/5 * * * *',
      $sql$SELECT public.invoke_scheduled_edge_function('import-sheets', '{}'::jsonb);$sql$
    );
  END IF;
END $$;
