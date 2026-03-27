
ALTER TABLE public.orders 
  ADD COLUMN IF NOT EXISTS postpone_note text DEFAULT '',
  ADD COLUMN IF NOT EXISTS original_agent_id uuid DEFAULT NULL;
