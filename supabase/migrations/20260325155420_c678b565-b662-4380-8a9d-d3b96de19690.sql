
CREATE POLICY "Sellers can update own products" ON public.products
  FOR UPDATE TO authenticated
  USING (auth.uid() = seller_id);
