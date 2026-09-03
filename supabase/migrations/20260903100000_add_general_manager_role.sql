-- New role: general_manager — a broad operational oversight role, custom-scoped
-- (not a full admin clone): Orders (without seller identity), Follow Ups (full),
-- WhatsApp Inbox only, Warehouse (full), Adjustments, Confirmation/Delivery
-- Analytics + Agent Monitoring (not Seller/Finance analytics, which surface
-- money/seller data), and Dashboard without the financial figures.
-- Split into its own migration because ALTER TYPE ... ADD VALUE cannot be used
-- in the same transaction as code that references the new value (same pattern
-- as whatsapp_manager's 20260819160000 migration).

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'general_manager';
