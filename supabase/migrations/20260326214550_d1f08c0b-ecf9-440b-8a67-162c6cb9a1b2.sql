CREATE OR REPLACE FUNCTION public.get_agent_rankings()
RETURNS TABLE(agent_id uuid, agent_name text, confirmed_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    o.agent_id,
    COALESCE(p.name, 'Unknown') as agent_name,
    COUNT(*) FILTER (WHERE o.confirmation_status = 'confirmed') as confirmed_count
  FROM public.orders o
  LEFT JOIN public.profiles p ON p.user_id = o.agent_id
  WHERE o.agent_id IS NOT NULL
    AND o.confirmation_status != 'new'
  GROUP BY o.agent_id, p.name
  ORDER BY confirmed_count DESC
  LIMIT 10
$$;