-- Daily online-time tracking, derived from the existing 30s presence
-- heartbeat (see src/hooks/usePresence.ts) rather than a new client-side
-- mechanism. `user_presence` only ever holds each user's CURRENT state (one
-- row per user, overwritten every heartbeat) — there was no history to
-- compute "hours online today" from. Instead of logging every 30s heartbeat
-- (huge, ~2880 rows/user/day), a trigger on user_presence accumulates the
-- elapsed time between consecutive heartbeats into one running total per
-- user per day.

CREATE TABLE public.user_online_daily (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day date NOT NULL, -- Asia/Karachi calendar day
  online_seconds integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

REVOKE ALL ON public.user_online_daily FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.track_user_online_time()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gap_seconds numeric;
  v_day date;
BEGIN
  -- Only accumulate when the previous heartbeat left the user active and
  -- this update's last_seen genuinely advanced — i.e. a real heartbeat,
  -- not just an is_active flip re-using the same timestamp.
  IF OLD.is_active IS TRUE AND NEW.last_seen > OLD.last_seen THEN
    v_gap_seconds := EXTRACT(EPOCH FROM (NEW.last_seen - OLD.last_seen));
    -- Cap a single gap at 90s (3x the 30s heartbeat interval) so a stale
    -- last_seen after a dropped connection or a closed laptop doesn't get
    -- counted as online time.
    IF v_gap_seconds > 0 AND v_gap_seconds <= 90 THEN
      v_day := (OLD.last_seen AT TIME ZONE 'Asia/Karachi')::date;
      INSERT INTO public.user_online_daily (user_id, day, online_seconds, updated_at)
      VALUES (NEW.user_id, v_day, v_gap_seconds::integer, now())
      ON CONFLICT (user_id, day)
      DO UPDATE SET
        online_seconds = public.user_online_daily.online_seconds + EXCLUDED.online_seconds,
        updated_at = now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_track_user_online_time ON public.user_presence;
CREATE TRIGGER trg_track_user_online_time
AFTER UPDATE ON public.user_presence
FOR EACH ROW
EXECUTE FUNCTION public.track_user_online_time();

-- Admin / General Manager only — reuses the RPC-gated access pattern already
-- used throughout this app (rather than granting table-level RLS/GRANTs).
CREATE OR REPLACE FUNCTION public.get_online_hours_today()
RETURNS TABLE (user_id uuid, online_seconds integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'general_manager')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT d.user_id, d.online_seconds
  FROM public.user_online_daily d
  WHERE d.day = (now() AT TIME ZONE 'Asia/Karachi')::date;
END;
$$;

NOTIFY pgrst, 'reload schema';
