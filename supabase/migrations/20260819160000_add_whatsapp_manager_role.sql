-- New role: whatsapp_manager — an operational role confined (via UI/route redirect,
-- same pattern as warehouse_manager) to the WhatsApp Inbox + Overview/Analytics pages.
-- Split into its own migration because ALTER TYPE ... ADD VALUE cannot be used in the
-- same transaction as code that references the new value.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'whatsapp_manager';
