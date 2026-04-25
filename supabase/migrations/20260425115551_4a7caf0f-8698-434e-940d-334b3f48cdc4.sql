CREATE OR REPLACE FUNCTION public.agent_has_treated_order(_order_id text, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.order_history oh
    WHERE oh.order_id = _order_id
      AND oh.changed_by = _user_id
  );
$$;

DROP POLICY IF EXISTS "Agents can view orders they treated in history" ON public.orders;

CREATE POLICY "Agents can view orders they treated in history"
ON public.orders
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'agent'::public.app_role)
  AND public.agent_has_treated_order(order_id, auth.uid())
);