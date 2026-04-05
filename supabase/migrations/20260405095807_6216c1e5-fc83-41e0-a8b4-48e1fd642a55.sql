
-- Add policy: allow agents to complete expired retry orders if they are the original agent
-- This covers no_answer and postponed orders where the lease expired (agent_id = NULL)
CREATE POLICY "Agents can complete expired retry orders" ON public.orders
FOR UPDATE TO authenticated
USING (
  agent_id IS NULL
  AND original_agent_id = auth.uid()
  AND confirmation_status IN ('no_answer', 'postponed')
  AND EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'agent')
)
WITH CHECK (auth.uid() = agent_id);
