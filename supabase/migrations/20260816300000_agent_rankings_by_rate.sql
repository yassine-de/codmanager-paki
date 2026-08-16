-- get_agent_rankings() previously only returned confirmed_count, so the
-- leaderboard ranked agents by raw confirmed-order volume. Return total_count
-- and new_count too so the frontend can rank by confirmation RATE instead
-- (using the same confirmationRatePercent formula used everywhere else in
-- the app), which doesn't unfairly favor agents who simply handle more volume.
DROP FUNCTION IF EXISTS public.get_agent_rankings();

CREATE OR REPLACE FUNCTION public.get_agent_rankings()
RETURNS TABLE(agent_id uuid, agent_name text, confirmed_count bigint, total_count bigint, new_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT o.agent_id, p.name,
    count(*) FILTER (WHERE o.confirmation_status = 'confirmed')::bigint,
    count(*)::bigint,
    count(*) FILTER (WHERE o.confirmation_status = 'new')::bigint
  FROM public.orders o
  LEFT JOIN public.profiles p ON p.user_id = o.agent_id
  WHERE o.agent_id IS NOT NULL
  GROUP BY o.agent_id, p.name
  HAVING count(*) FILTER (WHERE o.confirmation_status = 'confirmed') > 0
  ORDER BY count(*) FILTER (WHERE o.confirmation_status = 'confirmed') DESC;
$function$;
