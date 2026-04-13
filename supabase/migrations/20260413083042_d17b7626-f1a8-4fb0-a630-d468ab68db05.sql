
-- Function that calls orio-sync edge function via pg_net when delivery_status becomes 'booked'
CREATE OR REPLACE FUNCTION public.handle_orio_sync_on_booked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _supabase_url text;
  _service_key text;
BEGIN
  -- Only proceed if delivery_status changed to 'booked'
  IF NEW.delivery_status = 'booked' AND (OLD.delivery_status IS DISTINCT FROM 'booked') THEN
    -- Get stored config
    SELECT value INTO _supabase_url FROM app_settings WHERE key = 'supabase_url';
    SELECT value INTO _service_key FROM app_settings WHERE key = 'supabase_service_role_key';
    
    IF _supabase_url IS NOT NULL AND _service_key IS NOT NULL THEN
      PERFORM net.http_post(
        url := _supabase_url || '/functions/v1/orio-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || _service_key
        ),
        body := jsonb_build_object(
          'action', 'sync-order',
          'order_id', NEW.id::text
        )
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create the trigger
DROP TRIGGER IF EXISTS trigger_orio_sync_on_booked ON orders;
CREATE TRIGGER trigger_orio_sync_on_booked
  AFTER UPDATE ON orders
  FOR EACH ROW
  WHEN (NEW.delivery_status = 'booked' AND (OLD.delivery_status IS DISTINCT FROM 'booked'))
  EXECUTE FUNCTION public.handle_orio_sync_on_booked();
