-- Finalizing an invoice was failing with "Failed to finalize invoice" for any
-- invoice whose period_start/period_end are NULL (true for every invoice
-- auto-created by the finalize flow itself, which only sets {seller_id,
-- status: 'open'} and never a period) — string concatenation with `||`
-- collapses the whole `message` expression to NULL the moment one operand is
-- NULL, and seller_notifications.message is NOT NULL, so the INSERT inside
-- the AFTER UPDATE trigger raised a constraint violation and rolled back the
-- entire invoices UPDATE. Confirmed live: reproduced the exact error on a
-- real invoice (HG-INV-001) before this fix.
CREATE OR REPLACE FUNCTION public.notify_seller_invoice_ready()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.seller_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.finalized_at IS NOT NULL AND OLD.finalized_at IS NULL THEN
    INSERT INTO public.seller_notifications (seller_id, type, title, message, dedupe_key)
    VALUES (
      NEW.seller_id, 'invoice_ready', 'Invoice Ready',
      'Your invoice ' || COALESCE(NEW.invoice_number, NEW.id::text) ||
      CASE
        WHEN NEW.period_start IS NOT NULL AND NEW.period_end IS NOT NULL
          THEN ' for ' || NEW.period_start || ' to ' || NEW.period_end
        ELSE ''
      END || ' is ready',
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
$function$;

-- Same NULL-collapse risk for net_payable (nullable column) — defensive fix.
CREATE OR REPLACE FUNCTION public.notify_admin_invoice_payout_due()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.finalized_at IS NOT NULL AND OLD.finalized_at IS NULL AND NEW.paid_at IS NULL THEN
    INSERT INTO public.admin_notifications (type, title, message, reference_id, dedupe_key)
    VALUES (
      'invoice_payout_due', 'Seller Payout Due',
      'Invoice ' || COALESCE(NEW.invoice_number, NEW.id::text) || ' is finalized — payout of ' || COALESCE(NEW.net_payable, 0) || ' is due',
      NEW.id::text, 'invoice_payout_due:' || NEW.id
    )
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';
