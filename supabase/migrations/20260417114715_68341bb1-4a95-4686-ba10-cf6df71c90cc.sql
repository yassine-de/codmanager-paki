
-- 1. Add agent_name column
ALTER TABLE public.agent_activity_log
ADD COLUMN IF NOT EXISTS agent_name text;

-- 2. Backfill existing rows with current names from profiles
UPDATE public.agent_activity_log al
SET agent_name = COALESCE(p.name, 'Agent ' || substring(al.agent_id::text, 1, 8))
FROM public.profiles p
WHERE p.user_id = al.agent_id
  AND al.agent_name IS NULL;

-- For agents without profile, set fallback
UPDATE public.agent_activity_log
SET agent_name = 'Agent ' || substring(agent_id::text, 1, 8)
WHERE agent_name IS NULL;

-- 3. Trigger function to auto-fill agent_name on insert
CREATE OR REPLACE FUNCTION public.set_agent_activity_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name text;
BEGIN
  IF NEW.agent_name IS NULL OR NEW.agent_name = '' THEN
    SELECT name INTO v_name FROM public.profiles WHERE user_id = NEW.agent_id LIMIT 1;
    NEW.agent_name := COALESCE(v_name, 'Agent ' || substring(NEW.agent_id::text, 1, 8));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_agent_activity_name ON public.agent_activity_log;
CREATE TRIGGER trg_set_agent_activity_name
BEFORE INSERT ON public.agent_activity_log
FOR EACH ROW
EXECUTE FUNCTION public.set_agent_activity_name();
