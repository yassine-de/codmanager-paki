
-- Create calls table for tracking call durations per agent/order
CREATE TABLE public.calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL,
  agent_id uuid NOT NULL,
  call_start_time timestamptz NOT NULL DEFAULT now(),
  call_end_time timestamptz,
  duration integer GENERATED ALWAYS AS (
    CASE WHEN call_end_time IS NOT NULL 
      THEN EXTRACT(EPOCH FROM (call_end_time - call_start_time))::integer 
      ELSE NULL 
    END
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

-- Admins full access
CREATE POLICY "Admins full access calls"
  ON public.calls FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- Agents can insert their own calls
CREATE POLICY "Agents can insert own calls"
  ON public.calls FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = agent_id);

-- Agents can update own calls (to set call_end_time)
CREATE POLICY "Agents can update own calls"
  ON public.calls FOR UPDATE TO authenticated
  USING (auth.uid() = agent_id);

-- Agents can view own calls
CREATE POLICY "Agents can view own calls"
  ON public.calls FOR SELECT TO authenticated
  USING (auth.uid() = agent_id);

-- Index for performance
CREATE INDEX idx_calls_agent_id ON public.calls(agent_id);
CREATE INDEX idx_calls_order_id ON public.calls(order_id);
