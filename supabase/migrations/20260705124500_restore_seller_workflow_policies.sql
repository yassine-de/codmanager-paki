DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'orders'
      AND policyname = 'Sellers insert own orders'
  ) THEN
    CREATE POLICY "Sellers insert own orders"
    ON public.orders
    FOR INSERT
    TO authenticated
    WITH CHECK (seller_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'order_items'
      AND policyname = 'Sellers insert own order items'
  ) THEN
    CREATE POLICY "Sellers insert own order items"
    ON public.order_items
    FOR INSERT
    TO authenticated
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.orders o
        WHERE o.id = order_items.order_id
          AND o.seller_id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'seller_rates'
      AND policyname = 'Sellers view own rates'
  ) THEN
    CREATE POLICY "Sellers view own rates"
    ON public.seller_rates
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'rate_settings'
      AND policyname = 'Sellers view own rate settings'
  ) THEN
    CREATE POLICY "Sellers view own rate settings"
    ON public.rate_settings
    FOR SELECT
    TO authenticated
    USING (seller_id = auth.uid() OR seller_id IS NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'seller_payment_methods'
      AND policyname = 'Sellers manage own payment methods'
  ) THEN
    CREATE POLICY "Sellers manage own payment methods"
    ON public.seller_payment_methods
    FOR ALL
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sourcing_requests'
      AND policyname = 'Sellers manage own sourcing requests'
  ) THEN
    CREATE POLICY "Sellers manage own sourcing requests"
    ON public.sourcing_requests
    FOR ALL
    TO authenticated
    USING (seller_id = auth.uid())
    WITH CHECK (seller_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sourcing_history'
      AND policyname = 'Sellers view own sourcing history'
  ) THEN
    CREATE POLICY "Sellers view own sourcing history"
    ON public.sourcing_history
    FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM public.sourcing_requests sr
        WHERE sr.id = sourcing_history.sourcing_request_id
          AND sr.seller_id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'invoices'
      AND policyname = 'Sellers view own invoices'
  ) THEN
    CREATE POLICY "Sellers view own invoices"
    ON public.invoices
    FOR SELECT
    TO authenticated
    USING (seller_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'invoice_items'
      AND policyname = 'Sellers view own invoice items'
  ) THEN
    CREATE POLICY "Sellers view own invoice items"
    ON public.invoice_items
    FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM public.invoices i
        WHERE i.id = invoice_items.invoice_id
          AND i.seller_id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'invoice_addons'
      AND policyname = 'Sellers view own invoice addons'
  ) THEN
    CREATE POLICY "Sellers view own invoice addons"
    ON public.invoice_addons
    FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM public.invoices i
        WHERE i.id = invoice_addons.invoice_id
          AND i.seller_id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'invoice_history'
      AND policyname = 'Sellers view own invoice history'
  ) THEN
    CREATE POLICY "Sellers view own invoice history"
    ON public.invoice_history
    FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM public.invoices i
        WHERE i.id = invoice_history.invoice_id
          AND i.seller_id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'invoice_adjustments'
      AND policyname = 'Sellers view own invoice adjustments'
  ) THEN
    CREATE POLICY "Sellers view own invoice adjustments"
    ON public.invoice_adjustments
    FOR SELECT
    TO authenticated
    USING (seller_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'support_tickets'
      AND policyname = 'Sellers manage own support tickets'
  ) THEN
    CREATE POLICY "Sellers manage own support tickets"
    ON public.support_tickets
    FOR ALL
    TO authenticated
    USING (seller_id = auth.uid())
    WITH CHECK (seller_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'support_messages'
      AND policyname = 'Sellers view own support messages'
  ) THEN
    CREATE POLICY "Sellers view own support messages"
    ON public.support_messages
    FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM public.support_tickets st
        WHERE st.id = support_messages.ticket_id
          AND st.seller_id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'support_messages'
      AND policyname = 'Sellers insert own support messages'
  ) THEN
    CREATE POLICY "Sellers insert own support messages"
    ON public.support_messages
    FOR INSERT
    TO authenticated
    WITH CHECK (
      sender_id = auth.uid()
      AND EXISTS (
        SELECT 1
        FROM public.support_tickets st
        WHERE st.id = support_messages.ticket_id
          AND st.seller_id = auth.uid()
      )
    );
  END IF;
END $$;

