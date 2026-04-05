
-- Fix claim UPDATE policies: add explicit WITH CHECK so agents can update orders after claiming
-- Without this, the implicit WITH CHECK (same as USING) blocks status changes

-- Drop and recreate "Agents can claim unassigned orders" UPDATE policy
DROP POLICY IF EXISTS "Agents can claim unassigned orders" ON public.orders;
CREATE POLICY "Agents can claim unassigned orders" ON public.orders
FOR UPDATE TO authenticated
USING (
  agent_id IS NULL
  AND confirmation_status = 'new'
  AND EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'agent')
)
WITH CHECK (auth.uid() = agent_id);

-- Drop and recreate "Agents can claim released no_answer orders" UPDATE policy
DROP POLICY IF EXISTS "Agents can claim released no_answer orders" ON public.orders;
CREATE POLICY "Agents can claim released no_answer orders" ON public.orders
FOR UPDATE TO authenticated
USING (
  agent_id IS NULL
  AND confirmation_status = 'no_answer'
  AND EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'agent')
)
WITH CHECK (auth.uid() = agent_id);

-- Drop and recreate "Agents can claim postponed orders" UPDATE policy
DROP POLICY IF EXISTS "Agents can claim postponed orders" ON public.orders;
CREATE POLICY "Agents can claim postponed orders" ON public.orders
FOR UPDATE TO authenticated
USING (
  agent_id IS NULL
  AND confirmation_status = 'postponed'
  AND postpone_date <= now()
  AND EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'agent')
)
WITH CHECK (auth.uid() = agent_id);

-- Also fix "Agents can update assigned orders" to have explicit WITH CHECK
DROP POLICY IF EXISTS "Agents can update assigned orders" ON public.orders;
CREATE POLICY "Agents can update assigned orders" ON public.orders
FOR UPDATE TO authenticated
USING (auth.uid() = agent_id)
WITH CHECK (auth.uid() = agent_id);
