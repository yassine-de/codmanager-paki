-- Per-user day-by-day online-time history, backing a click-through from the
-- Team Status panel. Reuses user_online_daily (already keyed by user_id +
-- Asia/Karachi day, populated by the track_user_online_time() trigger) —
-- no new tracking needed, just a history read instead of just-today.

CREATE OR REPLACE FUNCTION public.get_user_online_history(p_user_id uuid, p_days integer DEFAULT 30)
RETURNS TABLE (day date, online_seconds integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'general_manager')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT d.day, d.online_seconds
  FROM public.user_online_daily d
  WHERE d.user_id = p_user_id
    AND d.day >= ((now() AT TIME ZONE 'Asia/Karachi')::date - (GREATEST(p_days, 1) - 1))
  ORDER BY d.day DESC;
END;
$$;

NOTIFY pgrst, 'reload schema';
