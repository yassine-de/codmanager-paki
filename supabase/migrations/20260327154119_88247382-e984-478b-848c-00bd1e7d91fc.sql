
-- Enable pg_cron and pg_net extensions for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Allow agents to update orders that were postponed and released back to queue (agent_id is null, was postponed)
CREATE POLICY "Agents can claim postponed orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (
  agent_id IS NULL 
  AND confirmation_status = 'postponed'
  AND postpone_date <= now()
  AND EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'agent')
);

-- Allow agents to view postponed orders available in queue
CREATE POLICY "Agents can view available postponed orders"
ON public.orders
FOR SELECT
TO authenticated
USING (
  agent_id IS NULL 
  AND confirmation_status = 'postponed'
  AND postpone_date <= now()
  AND EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'agent')
);

-- Allow agents to view and claim no_answer orders that were released
CREATE POLICY "Agents can view released no_answer orders"
ON public.orders
FOR SELECT
TO authenticated
USING (
  agent_id IS NULL 
  AND confirmation_status = 'no_answer'
  AND EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'agent')
);

CREATE POLICY "Agents can claim released no_answer orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (
  agent_id IS NULL 
  AND confirmation_status = 'no_answer'
  AND EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'agent')
);
