-- Store agent product assignments
CREATE TABLE public.agent_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL,
  product_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_id, product_name)
);

ALTER TABLE public.agent_products ENABLE ROW LEVEL SECURITY;

-- Admins can manage
CREATE POLICY "Admins manage agent_products"
ON public.agent_products FOR ALL TO authenticated
USING (is_admin(auth.uid()))
WITH CHECK (is_admin(auth.uid()));

-- Agents can view their own assignments
CREATE POLICY "Agents view own products"
ON public.agent_products FOR SELECT TO authenticated
USING (auth.uid() = agent_id);