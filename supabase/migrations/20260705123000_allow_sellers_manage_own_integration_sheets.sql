DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'integration_sheets'
      AND policyname = 'Sellers manage own integration sheets'
  ) THEN
    CREATE POLICY "Sellers manage own integration sheets"
    ON public.integration_sheets
    FOR ALL
    TO authenticated
    USING (seller_id = auth.uid())
    WITH CHECK (seller_id = auth.uid());
  END IF;
END $$;
