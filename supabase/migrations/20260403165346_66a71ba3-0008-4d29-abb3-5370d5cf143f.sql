
-- Drop the OLD overload with (uuid, text[], text) signature
DROP FUNCTION IF EXISTS public.claim_next_order(uuid, text[], text);
