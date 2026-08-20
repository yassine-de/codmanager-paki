-- Grant whatsapp_manager the same blanket is_staff() database access every other
-- operational role already has (agent, follow_up, warehouse_agent, warehouse_manager) —
-- consistent with the existing security model in this app, where DB-level access is
-- broad and the actual restriction to a role's own pages happens at the UI/route layer
-- (sidebar filtering + a hard redirect, same pattern as warehouse_manager's confinement
-- to /warehouse/*). WhatsApp Inbox needs to read/write orders, order_history, order_items,
-- products, product_variants, whatsapp_conversations, whatsapp_messages, whatsapp_templates
-- to function (confirming orders, updating delivery status, replying to customers) — a
-- narrower read-only policy would break the Inbox itself.

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin', 'agent', 'follow_up', 'warehouse_agent', 'warehouse_manager', 'whatsapp_manager')
  );
$$;
