-- deliveries: no more public read. Admin sees all; staff see deliveries they made.
-- Storefront fee model reads public.delivery_fee_quotes instead (previous migration).
drop policy if exists "public read deliveries" on public.deliveries;
create policy "pos admin select deliveries" on public.deliveries
  for select to authenticated using (public.is_pos_admin());
create policy "pos staff select own deliveries" on public.deliveries
  for select to authenticated using (public.is_pos_user() and delivered_by = auth.uid());
