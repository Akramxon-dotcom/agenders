
CREATE POLICY "owner can read own space" ON public.spaces
  FOR SELECT TO authenticated USING (auth.uid() = owner_id);
