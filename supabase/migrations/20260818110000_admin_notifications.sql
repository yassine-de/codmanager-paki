-- Real, broadcast notifications for admins. Unlike agent_notifications /
-- seller_notifications (single owner per row), there are multiple admin
-- accounts (confirmed: Anwar Bounasser, Adil Hachmaoui, Badereddine Ait
-- Boulouden all hold role='admin'), so this uses a broadcast table plus a
-- per-admin read-tracking join table — each admin independently
-- sees/dismisses the same underlying notification.
--
-- Six kinds:
--   1. sourcing_request            — new sourcing request submitted
--   2. support_ticket              — new support ticket / escalation opened
--   3. adjustment_pending          — new invoice adjustment needs review
--   4. invoice_needs_finalization  — a new invoice was generated
--   5. invoice_payout_due          — an invoice was finalized, seller unpaid
--   6. metric_spike                — shipping sync errors or unassigned
--                                    orders crossed a concerning threshold
--                                    (same thresholds/queries already used
--                                    by SystemStatusPanel.tsx, so this never
--                                    disagrees with the live dashboard)

CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN (
    'sourcing_request', 'support_ticket', 'adjustment_pending',
    'invoice_needs_finalization', 'invoice_payout_due', 'metric_spike'
  )),
  title text NOT NULL,
  message text NOT NULL,
  reference_id text,
  dedupe_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_created ON public.admin_notifications (created_at DESC);

ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin read all notifications"
ON public.admin_notifications FOR SELECT TO authenticated
USING (public.is_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.admin_notification_reads (
  notification_id uuid NOT NULL REFERENCES public.admin_notifications(id) ON DELETE CASCADE,
  admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, admin_id)
);

ALTER TABLE public.admin_notification_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin manage own reads"
ON public.admin_notification_reads FOR ALL TO authenticated
USING (admin_id = auth.uid() AND public.is_admin(auth.uid()))
WITH CHECK (admin_id = auth.uid() AND public.is_admin(auth.uid()));

-- ── sourcing_request ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_admin_sourcing_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.admin_notifications (type, title, message, reference_id, dedupe_key)
  VALUES (
    'sourcing_request', 'New Sourcing Request',
    'New sourcing request for ' || COALESCE(NEW.product_name, 'a product') || ' needs review',
    NEW.id::text, 'sourcing_request:' || NEW.id
  )
  ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_admin_sourcing_request ON public.sourcing_requests;
CREATE TRIGGER trg_notify_admin_sourcing_request
AFTER INSERT ON public.sourcing_requests
FOR EACH ROW
EXECUTE FUNCTION public.notify_admin_sourcing_request();

-- ── support_ticket ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_admin_support_ticket()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.admin_notifications (type, title, message, reference_id, dedupe_key)
  VALUES (
    'support_ticket', 'New Support Ticket',
    'New ' || COALESCE(NEW.issue_type, 'support') || ' ticket needs a response',
    NEW.id::text, 'support_ticket:' || NEW.id
  )
  ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_admin_support_ticket ON public.support_tickets;
CREATE TRIGGER trg_notify_admin_support_ticket
AFTER INSERT ON public.support_tickets
FOR EACH ROW
EXECUTE FUNCTION public.notify_admin_support_ticket();

-- ── adjustment_pending ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_admin_adjustment_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    INSERT INTO public.admin_notifications (type, title, message, reference_id, dedupe_key)
    VALUES (
      'adjustment_pending', 'Adjustment Needs Review',
      'A ' || COALESCE(NEW.type, 'invoice') || ' adjustment for order ' || COALESCE(NEW.order_id, '') || ' needs review',
      NEW.id::text, 'adjustment_pending:' || NEW.id
    )
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_admin_adjustment_pending ON public.invoice_adjustments;
CREATE TRIGGER trg_notify_admin_adjustment_pending
AFTER INSERT ON public.invoice_adjustments
FOR EACH ROW
EXECUTE FUNCTION public.notify_admin_adjustment_pending();

-- ── invoice_needs_finalization / invoice_payout_due ──────────────────────
CREATE OR REPLACE FUNCTION public.notify_admin_invoice_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.admin_notifications (type, title, message, reference_id, dedupe_key)
  VALUES (
    'invoice_needs_finalization', 'Invoice Needs Finalization',
    'Invoice ' || COALESCE(NEW.invoice_number, NEW.id::text) || ' was generated and needs finalization',
    NEW.id::text, 'invoice_needs_finalization:' || NEW.id
  )
  ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_admin_invoice_created ON public.invoices;
CREATE TRIGGER trg_notify_admin_invoice_created
AFTER INSERT ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.notify_admin_invoice_created();

CREATE OR REPLACE FUNCTION public.notify_admin_invoice_payout_due()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.finalized_at IS NOT NULL AND OLD.finalized_at IS NULL AND NEW.paid_at IS NULL THEN
    INSERT INTO public.admin_notifications (type, title, message, reference_id, dedupe_key)
    VALUES (
      'invoice_payout_due', 'Seller Payout Due',
      'Invoice ' || COALESCE(NEW.invoice_number, NEW.id::text) || ' is finalized — payout of ' || NEW.net_payable || ' is due',
      NEW.id::text, 'invoice_payout_due:' || NEW.id
    )
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_admin_invoice_payout_due ON public.invoices;
CREATE TRIGGER trg_notify_admin_invoice_payout_due
AFTER UPDATE OF finalized_at ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.notify_admin_invoice_payout_due();

-- ── metric_spike sweep ────────────────────────────────────────────────────
-- Reuses the EXACT queries/thresholds SystemStatusPanel.tsx already uses,
-- so this never disagrees with what's live on the dashboard. Deduped to at
-- most once per day per metric while it stays above threshold (a simple,
-- low-complexity choice — pings once a day for an ongoing issue rather
-- than every 5 minutes, no extra crossing-detection state needed).
CREATE OR REPLACE FUNCTION public.sweep_admin_metric_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sync_errors integer;
  v_unassigned integer;
  v_today text := to_char(now() AT TIME ZONE 'Asia/Karachi', 'YYYY-MM-DD');
BEGIN
  SELECT count(*) INTO v_sync_errors FROM public.shipments WHERE sync_status = 'failed';
  IF v_sync_errors > 0 THEN
    INSERT INTO public.admin_notifications (type, title, message, dedupe_key)
    VALUES (
      'metric_spike', 'Shipping Sync Errors Spiked',
      v_sync_errors || ' shipment' || CASE WHEN v_sync_errors = 1 THEN '' ELSE 's' END || ' failed to sync',
      'metric_spike:sync_errors:' || v_today
    )
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;

  SELECT count(*) INTO v_unassigned FROM public.orders WHERE confirmation_status = 'new' AND agent_id IS NULL;
  IF v_unassigned > 5 THEN
    INSERT INTO public.admin_notifications (type, title, message, dedupe_key)
    VALUES (
      'metric_spike', 'Unassigned Orders Piling Up',
      v_unassigned || ' new orders are unassigned',
      'metric_spike:unassigned_orders:' || v_today
    )
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_admin_metric_notifications() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'admin-metric-notifications-sweep') THEN
    PERFORM cron.unschedule('admin-metric-notifications-sweep');
  END IF;
END $$;

SELECT cron.schedule('admin-metric-notifications-sweep', '*/10 * * * *', $$SELECT public.sweep_admin_metric_notifications();$$);

NOTIFY pgrst, 'reload schema';
