INSERT INTO public.carriers (
  code,
  name,
  enabled,
  fulfillment_mode,
  supports_cod,
  supports_tracking,
  supports_bulk_tracking,
  supports_labels,
  supports_load_sheet,
  supports_cancel,
  supports_payment_status,
  priority,
  settings,
  updated_at
)
VALUES (
  'mnp',
  'M&P',
  false,
  'self_fulfilled',
  true,
  true,
  true,
  true,
  false,
  true,
  true,
  20,
  '{"label_api_status":"html_endpoint","label_endpoint":"GetAddressLabel_HTML_image.aspx"}'::jsonb,
  now()
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  fulfillment_mode = EXCLUDED.fulfillment_mode,
  supports_cod = EXCLUDED.supports_cod,
  supports_tracking = EXCLUDED.supports_tracking,
  supports_bulk_tracking = EXCLUDED.supports_bulk_tracking,
  supports_labels = EXCLUDED.supports_labels,
  supports_cancel = EXCLUDED.supports_cancel,
  supports_payment_status = EXCLUDED.supports_payment_status,
  settings = carriers.settings || EXCLUDED.settings,
  updated_at = now();

INSERT INTO public.app_settings (key, value, is_public, updated_at)
VALUES
  ('active_carrier_code', 'postex', false, now()),
  ('mnp_username', 'SCALERSPRIVATELIMITED_1S800', false, now()),
  ('mnp_account_no', '1S800', false, now()),
  ('mnp_location_id', '126306', false, now()),
  ('mnp_return_location', '126306', false, now()),
  ('mnp_sub_account_id', '72891', false, now()),
  ('mnp_insert_type', '19', false, now()),
  ('mnp_service', 'Overnight', false, now()),
  ('mnp_label_type', '3', false, now()),
  ('mnp_default_weight', '1', false, now()),
  ('mnp_default_fragile', 'NO', false, now()),
  ('mnp_insurance_value', '0', false, now())
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  is_public = EXCLUDED.is_public,
  updated_at = now();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'carrier-shipping-retry') THEN
    PERFORM cron.unschedule('carrier-shipping-retry');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mnp-carrier-status-sync') THEN
    PERFORM cron.unschedule('mnp-carrier-status-sync');
  END IF;
END $$;

SELECT cron.schedule(
  'carrier-shipping-retry',
  '*/5 * * * *',
  $$SELECT public.invoke_scheduled_edge_function('shipping-sync-retry', '{}'::jsonb);$$
);

SELECT cron.schedule(
  'mnp-carrier-status-sync',
  '*/5 * * * *',
  $$SELECT public.invoke_scheduled_edge_function('mnp-carrier-status-sync', '{}'::jsonb);$$
);
