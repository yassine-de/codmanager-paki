-- Grant general_manager the same blanket is_staff() database access every other
-- operational role already has (agent, follow_up, warehouse_agent,
-- warehouse_manager, whatsapp_manager) — consistent with the existing security
-- model in this app, where DB-level access is broad and the actual
-- restriction to a role's own pages happens at the UI/route layer (sidebar
-- filtering + explicit role checks per page, same pattern as
-- warehouse_manager/whatsapp_manager). General Manager needs read/write on
-- orders, order_history, order_follow_ups, shipments, fulfillment_items,
-- invoice_adjustments, and whatsapp_conversations/messages to actually use
-- Orders, Follow Ups, Warehouse, Adjustments and the WhatsApp Inbox.

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin', 'agent', 'follow_up', 'warehouse_agent', 'warehouse_manager', 'whatsapp_manager', 'general_manager')
  );
$$;
