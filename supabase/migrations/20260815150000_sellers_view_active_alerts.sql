-- Sellers currently have NO RLS access to public.alerts at all — the table
-- only carries the blanket "Staff manage alerts" policy (is_staff()), which
-- excludes the seller role entirely. SellerAlertsBanner.tsx queries this
-- table as the logged-in seller, so every request silently returns zero
-- rows regardless of is_active/start_date/end_date. Add a narrow SELECT
-- policy so any authenticated user can read alerts that are currently
-- active and within their optional date range (announcement content only,
-- nothing sensitive — staff already have full access via the existing policy).

CREATE POLICY "Authenticated view active alerts" ON public.alerts
  FOR SELECT TO authenticated
  USING (
    is_active
    AND (start_date IS NULL OR start_date <= now())
    AND (end_date IS NULL OR end_date >= now())
  );

NOTIFY pgrst, 'reload schema';
