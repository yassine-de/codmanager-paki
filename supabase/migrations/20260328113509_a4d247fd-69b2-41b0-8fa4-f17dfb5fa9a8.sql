
ALTER TABLE public.support_messages ADD COLUMN read_at timestamp with time zone DEFAULT NULL;

-- Allow sellers to update read_at on their own ticket messages (for marking admin messages as read)
CREATE POLICY "Sellers can mark messages read" ON public.support_messages
FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM support_tickets
  WHERE support_tickets.id = support_messages.ticket_id
  AND support_tickets.seller_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM support_tickets
  WHERE support_tickets.id = support_messages.ticket_id
  AND support_tickets.seller_id = auth.uid()
));
