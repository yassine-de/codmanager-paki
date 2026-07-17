-- Restore old agent lock helper signatures used by the agent confirmation page.
-- Also release stale locks created by the previous simplified claim RPC, where
-- assigned_at was set but last_activity_at stayed NULL.

CREATE OR REPLACE FUNCTION public.release_expired_order_locks()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.orders
  SET agent_id = NULL,
      assigned_at = NULL,
      last_activity_at = NULL,
      updated_at = now()
  WHERE agent_id IS NOT NULL
    AND confirmation_status IN ('new', 'no_answer', 'postponed')
    AND COALESCE(last_activity_at, assigned_at) IS NOT NULL
    AND COALESCE(last_activity_at, assigned_at) < now() - interval '6 minutes';
$$;

CREATE OR REPLACE FUNCTION public.touch_order_lock(p_order_id uuid, p_agent_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.orders
  SET last_activity_at = now(),
      updated_at = now()
  WHERE id = p_order_id
    AND agent_id = p_agent_id;
$$;

CREATE OR REPLACE FUNCTION public.release_order_lock(p_order_id uuid, p_agent_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.orders
  SET agent_id = NULL,
      assigned_at = NULL,
      last_activity_at = NULL,
      updated_at = now()
  WHERE id = p_order_id
    AND agent_id = p_agent_id
    AND confirmation_status IN ('new', 'no_answer', 'postponed');
$$;

GRANT EXECUTE ON FUNCTION public.release_expired_order_locks() TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_order_lock(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_order_lock(uuid, uuid) TO authenticated;

SELECT public.release_expired_order_locks();

NOTIFY pgrst, 'reload schema';
