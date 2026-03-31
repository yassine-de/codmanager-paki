
CREATE OR REPLACE FUNCTION public.trigger_orio_sync_on_confirm()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_supabase_url text;
  v_service_key text;
BEGIN
  IF NEW.confirmation_status = 'confirmed'
     AND (OLD.confirmation_status IS DISTINCT FROM 'confirmed')
     AND (NEW.orio_order_id IS NULL)
     AND (NEW.orio_sync_status IS DISTINCT FROM 'synced')
  THEN
    NEW.orio_sync_status := 'pending';

    -- Read from app_settings instead of vault
    SELECT value INTO v_supabase_url FROM public.app_settings WHERE key = 'supabase_url' LIMIT 1;
    SELECT value INTO v_service_key FROM public.app_settings WHERE key = 'supabase_service_role_key' LIMIT 1;

    IF v_supabase_url IS NOT NULL AND v_service_key IS NOT NULL THEN
      PERFORM net.http_post(
        url := v_supabase_url || '/functions/v1/orio-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_service_key
        ),
        body := jsonb_build_object('action', 'sync-order', 'order_id', NEW.id::text)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
