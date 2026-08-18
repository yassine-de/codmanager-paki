-- Real, per-seller notifications, mirroring the agent_notifications design
-- (see 20260817160000_agent_notifications.sql) but scoped to seller_id.
-- Isolation is the top priority here — sellers are effectively separate
-- tenants — so every trigger below only ever reads/writes rows already
-- scoped to a single seller_id, and RLS strictly enforces seller_id =
-- auth.uid() on both read and the mark-as-read update. Five kinds:
--   1. order_delivered   — one of her orders was delivered (event)
--   2. order_returned    — one of her orders came back (event)
--   3. sheet_sync_failed — her own Sheet integration hit a NEW error (event)
--   4. low_stock         — one of her products crossed into low stock (event)
--   5. invoice_ready     — her invoice was finalized or paid (event)

CREATE TABLE IF NOT EXISTS public.seller_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('order_delivered', 'order_returned', 'sheet_sync_failed', 'low_stock', 'invoice_ready')),
  title text NOT NULL,
  message text NOT NULL,
  order_id text,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (seller_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_seller_notifications_seller ON public.seller_notifications (seller_id, created_at DESC);

ALTER TABLE public.seller_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "seller read own notifications"
ON public.seller_notifications FOR SELECT TO authenticated
USING (seller_id = auth.uid());

CREATE POLICY "seller mark own notifications read"
ON public.seller_notifications FOR UPDATE TO authenticated
USING (seller_id = auth.uid()) WITH CHECK (seller_id = auth.uid());

CREATE POLICY "admin manage seller notifications"
ON public.seller_notifications FOR ALL TO authenticated
USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- ── order_delivered / order_returned ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_seller_order_delivered()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.seller_id IS NOT NULL
     AND NEW.delivery_status = 'delivered'
     AND OLD.delivery_status IS DISTINCT FROM 'delivered'
  THEN
    INSERT INTO public.seller_notifications (seller_id, type, title, message, order_id, dedupe_key)
    VALUES (
      NEW.seller_id, 'order_delivered', 'Order Delivered',
      'Order ' || NEW.order_id || ' was delivered',
      NEW.order_id, 'delivered:' || NEW.order_id
    )
    ON CONFLICT (seller_id, dedupe_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_seller_order_delivered ON public.orders;
CREATE TRIGGER trg_notify_seller_order_delivered
AFTER UPDATE OF delivery_status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.notify_seller_order_delivered();

CREATE OR REPLACE FUNCTION public.notify_seller_order_returned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.seller_id IS NOT NULL
     AND NEW.delivery_status IN ('return', 'return_received', 'returned')
     AND OLD.delivery_status IS DISTINCT FROM NEW.delivery_status
     AND COALESCE(OLD.delivery_status, '') NOT IN ('return', 'return_received', 'returned')
  THEN
    INSERT INTO public.seller_notifications (seller_id, type, title, message, order_id, dedupe_key)
    VALUES (
      NEW.seller_id, 'order_returned', 'Order Returned',
      'Order ' || NEW.order_id || ' was returned',
      NEW.order_id, 'returned:' || NEW.order_id
    )
    ON CONFLICT (seller_id, dedupe_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_seller_order_returned ON public.orders;
CREATE TRIGGER trg_notify_seller_order_returned
AFTER UPDATE OF delivery_status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.notify_seller_order_returned();

-- ── sheet_sync_failed — only on a NEW error (errors_count increasing) ────
CREATE OR REPLACE FUNCTION public.notify_seller_sheet_sync_failed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.seller_id IS NOT NULL
     AND NEW.errors_count > COALESCE(OLD.errors_count, 0)
  THEN
    INSERT INTO public.seller_notifications (seller_id, type, title, message, dedupe_key)
    VALUES (
      NEW.seller_id, 'sheet_sync_failed', 'Sheet Sync Failed',
      'Your sheet "' || COALESCE(NEW.sheet_name, NEW.name) || '" failed to sync',
      'sheet_sync_failed:' || NEW.id || ':' || NEW.errors_count
    )
    ON CONFLICT (seller_id, dedupe_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_seller_sheet_sync_failed ON public.integration_sheets;
CREATE TRIGGER trg_notify_seller_sheet_sync_failed
AFTER UPDATE OF errors_count ON public.integration_sheets
FOR EACH ROW
EXECUTE FUNCTION public.notify_seller_sheet_sync_failed();

-- ── low_stock — only when CROSSING into low stock (not while staying low) ─
CREATE OR REPLACE FUNCTION public.notify_seller_low_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_threshold constant integer := 5;
BEGIN
  IF NEW.seller_id IS NOT NULL
     AND NEW.quantity IS NOT NULL
     AND NEW.quantity <= v_threshold
     AND (OLD.quantity IS NULL OR OLD.quantity > v_threshold)
  THEN
    INSERT INTO public.seller_notifications (seller_id, type, title, message, dedupe_key)
    VALUES (
      NEW.seller_id, 'low_stock', 'Low Stock',
      NEW.name || ' is running low (' || NEW.quantity || ' left)',
      'low_stock:' || NEW.id || ':' || NEW.quantity
    )
    ON CONFLICT (seller_id, dedupe_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_seller_low_stock ON public.products;
CREATE TRIGGER trg_notify_seller_low_stock
AFTER UPDATE OF quantity ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.notify_seller_low_stock();

-- ── invoice_ready — finalized or paid ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_seller_invoice_ready()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.seller_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.finalized_at IS NOT NULL AND OLD.finalized_at IS NULL THEN
    INSERT INTO public.seller_notifications (seller_id, type, title, message, dedupe_key)
    VALUES (
      NEW.seller_id, 'invoice_ready', 'Invoice Ready',
      'Your invoice ' || COALESCE(NEW.invoice_number, NEW.id::text) || ' for ' || NEW.period_start || ' to ' || NEW.period_end || ' is ready',
      'invoice_finalized:' || NEW.id
    )
    ON CONFLICT (seller_id, dedupe_key) DO NOTHING;
  END IF;

  IF NEW.paid_at IS NOT NULL AND OLD.paid_at IS NULL THEN
    INSERT INTO public.seller_notifications (seller_id, type, title, message, dedupe_key)
    VALUES (
      NEW.seller_id, 'invoice_ready', 'Payment Processed',
      'Payment for invoice ' || COALESCE(NEW.invoice_number, NEW.id::text) || ' was processed',
      'invoice_paid:' || NEW.id
    )
    ON CONFLICT (seller_id, dedupe_key) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_seller_invoice_ready ON public.invoices;
CREATE TRIGGER trg_notify_seller_invoice_ready
AFTER UPDATE OF finalized_at, paid_at ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.notify_seller_invoice_ready();

NOTIFY pgrst, 'reload schema';
