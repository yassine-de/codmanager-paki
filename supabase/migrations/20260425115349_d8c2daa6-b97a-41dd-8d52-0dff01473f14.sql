-- Drop the open claim policies for retry orders
DROP POLICY IF EXISTS "Agents can claim postponed orders" ON public.orders;
DROP POLICY IF EXISTS "Agents can claim released no_answer orders" ON public.orders;
DROP POLICY IF EXISTS "Agents can view available postponed orders" ON public.orders;
DROP POLICY IF EXISTS "Agents can view released no_answer orders" ON public.orders;

-- Re-create them restricted to the original agent
CREATE POLICY "Agents can claim own postponed orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (
  agent_id IS NULL
  AND confirmation_status = 'postponed'
  AND postpone_date <= now()
  AND original_agent_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'agent'::app_role
  )
)
WITH CHECK (auth.uid() = agent_id);

CREATE POLICY "Agents can claim own released no_answer orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (
  agent_id IS NULL
  AND confirmation_status = 'no_answer'
  AND original_agent_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'agent'::app_role
  )
)
WITH CHECK (auth.uid() = agent_id);

CREATE POLICY "Agents can view own available postponed orders"
ON public.orders
FOR SELECT
TO authenticated
USING (
  agent_id IS NULL
  AND confirmation_status = 'postponed'
  AND postpone_date <= now()
  AND original_agent_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'agent'::app_role
  )
);

CREATE POLICY "Agents can view own released no_answer orders"
ON public.orders
FOR SELECT
TO authenticated
USING (
  agent_id IS NULL
  AND confirmation_status = 'no_answer'
  AND original_agent_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'agent'::app_role
  )
);