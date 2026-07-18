CREATE POLICY "Sellers view own integration errors"
  ON public.integration_errors
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.integration_sheets
      WHERE integration_sheets.id = integration_errors.sheet_id
        AND integration_sheets.seller_id = auth.uid()
    )
  );
