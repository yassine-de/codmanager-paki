
-- Support tickets table
CREATE TABLE public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL,
  issue_type text NOT NULL DEFAULT 'other',
  related_id text DEFAULT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access support_tickets" ON public.support_tickets
  FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Sellers view own tickets" ON public.support_tickets
  FOR SELECT TO authenticated
  USING (auth.uid() = seller_id);

CREATE POLICY "Sellers create own tickets" ON public.support_tickets
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = seller_id);

CREATE POLICY "Sellers update own tickets" ON public.support_tickets
  FOR UPDATE TO authenticated
  USING (auth.uid() = seller_id);

-- Support messages table
CREATE TABLE public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  sender_type text NOT NULL DEFAULT 'seller',
  message text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access support_messages" ON public.support_messages
  FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Sellers view own ticket messages" ON public.support_messages
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.support_tickets
    WHERE support_tickets.id = support_messages.ticket_id
    AND support_tickets.seller_id = auth.uid()
  ));

CREATE POLICY "Sellers insert own ticket messages" ON public.support_messages
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.support_tickets
    WHERE support_tickets.id = support_messages.ticket_id
    AND support_tickets.seller_id = auth.uid()
  ));

-- Enable realtime for support_messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_tickets;
