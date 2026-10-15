-- Staff (pos_staff) may not record wholesale cookie lines. Admin and service role unaffected.
create or replace function public.trg_sales_block_staff_wholesale()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_pos_admin() then
    return new;
  end if;
  if jsonb_typeof(new.items) = 'array' and exists (
       select 1 from jsonb_array_elements(new.items) it
        where lower(coalesce(it ->> 'product_id', '') || ' ' || coalesce(it ->> 'product_name', '')) like '%wholesale%')
     and (tg_op = 'INSERT' or new.items is distinct from old.items) then
    raise exception 'Wholesale cookie sales are admin-only' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists sales_block_staff_wholesale on public.sales;
create trigger sales_block_staff_wholesale before insert or update on public.sales
  for each row execute function public.trg_sales_block_staff_wholesale();
