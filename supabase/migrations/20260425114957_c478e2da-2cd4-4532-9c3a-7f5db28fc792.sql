-- Allow agents to view orders they previously treated (have order_history entries for)
CREATE POLICY "Agents can view orders they treated in history"
ON public.orders
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.order_history oh
    WHERE oh.order_id = orders.order_id
      AND oh.changed_by = auth.uid()
  )
);