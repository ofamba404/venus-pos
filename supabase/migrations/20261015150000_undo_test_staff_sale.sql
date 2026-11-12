-- Undo the test sale made by test-staff@venus.local (Commander's Stash, 35,000, 2026-10-15 04:20 UTC).
-- Reverses exactly the logged deductions (inventory_adjustments ids 2-6), logs the reversal as an
-- admin adjustment, then deletes the sale's adjustment rows and the sale. Aborts if anything differs.
do $$
declare
  v_sale constant uuid := '11b30081-bb8f-4e14-b05d-b47fc36ab6c2';
  v_staff constant uuid := 'f8047e15-aad0-4d0d-9737-2a2c17fe39de';
  v_admin constant uuid := '0cddbf3f-dad5-41f3-8516-1ac47b049f01';
  r record;
  new_stock integer;
begin
  if not exists (select 1 from public.sales where id = v_sale and seller_id = v_staff and total_ugx = 35000) then
    raise exception 'test sale not found / not owned by test staff';
  end if;
  if exists (select 1 from public.store_orders where sale_id = v_sale)
     or exists (select 1 from public.credit_payments where sale_id = v_sale)
     or exists (select 1 from public.deliveries where sale_id = v_sale) then
    raise exception 'unexpected dependent rows (store order / credit payment / delivery) — stop';
  end if;
  if (select count(*) from public.inventory_adjustments where sale_id = v_sale) <> 5 then
    raise exception 'expected exactly 5 sale adjustments';
  end if;
  for r in select category_id, delta from public.inventory_adjustments where sale_id = v_sale and reason = 'sale' loop
    update public.inventory set stock = stock - r.delta, updated_at = now()
     where category_id = r.category_id returning stock into new_stock;
    insert into public.inventory_adjustments (user_id, category_id, delta, stock_after, reason, sale_id, note)
    values (v_admin, r.category_id, -r.delta, new_stock, 'undo test sale', null,
            'Reversal of test sale ' || v_sale || ' by test-staff@venus.local');
  end loop;
  delete from public.inventory_adjustments where sale_id = v_sale;
  delete from public.sales where id = v_sale;
end $$;
