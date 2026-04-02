CREATE OR REPLACE FUNCTION public.release_order_lock(p_order_id uuid, p_agent_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  UPDATE orders
  SET agent_id = NULL, assigned_at = NULL, last_activity_at = NULL
  WHERE id = p_order_id
    AND agent_id = p_agent_id
    AND confirmation_status IN ('new', 'no_answer', 'postponed');
$$;

CREATE OR REPLACE FUNCTION public.release_expired_order_locks()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  UPDATE orders
  SET agent_id = NULL, assigned_at = NULL, last_activity_at = NULL
  WHERE agent_id IS NOT NULL
    AND confirmation_status IN ('new', 'no_answer', 'postponed')
    AND last_activity_at IS NOT NULL
    AND last_activity_at < now() - interval '5 minutes';
$$;