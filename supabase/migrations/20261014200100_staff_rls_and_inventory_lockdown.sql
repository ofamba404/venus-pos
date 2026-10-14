-- Staff: own sales only, same Kampala day, no credit settlement, no delete.
-- Inventory: staff read-only; sale-driven deductions via apply_sale_stock().

create or replace function public.kampala_today()
returns date language sql stable as $$
  select (now() at time zone 'Africa/Kampala')::date;
$$;

-- ---------- sales ----------
drop policy if exists "pos user select sales" on public.sales;
drop policy if exists "pos user update sales" on public.sales;
drop policy if exists "pos user insert sales" on public.sales;

create policy "pos admin select sales" on public.sales
  for select to authenticated using (public.is_pos_admin());
create policy "pos staff select own sales" on public.sales
  for select to authenticated
  using (public.is_pos_user() and seller_id = auth.uid());

create policy "pos user insert sales" on public.sales
  for insert to authenticated
  with check (public.is_pos_admin() or (public.is_pos_user() and seller_id = auth.uid()));

create policy "pos admin update sales" on public.sales
  for update to authenticated
  using (public.is_pos_admin()) with check (public.is_pos_admin());
create policy "pos staff update own same-day sales" on public.sales
  for update to authenticated
  using (public.is_pos_user() and seller_id = auth.uid()
         and (created_at at time zone 'Africa/Kampala')::date = public.kampala_today())
  with check (public.is_pos_user() and seller_id = auth.uid()
         and (created_at at time zone 'Africa/Kampala')::date = public.kampala_today());
-- delete stays admin-only ("pos admin delete sales" unchanged)

-- Columns staff may not change on update.
create or replace function public.trg_sales_staff_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_pos_admin() then
    return new;
  end if;
  new.credit_cleared  := old.credit_cleared;
  new.cleared_at      := old.cleared_at;
  new.amount_paid_ugx := old.amount_paid_ugx;
  new.created_at      := old.created_at;
  return new;
end;
$$;
drop trigger if exists sales_staff_guard on public.sales;
create trigger sales_staff_guard before update on public.sales
  for each row execute function public.trg_sales_staff_guard();

-- Staff may only record credit payments via admin; restrict insert to admin.
drop policy if exists "pos user insert credit_payments" on public.credit_payments;
create policy "pos admin insert credit_payments" on public.credit_payments
  for insert to authenticated with check (public.is_pos_admin());
drop policy if exists "pos user select credit_payments" on public.credit_payments;
create policy "pos admin select credit_payments" on public.credit_payments
  for select to authenticated using (public.is_pos_admin());
create policy "pos staff select own credit_payments" on public.credit_payments
  for select to authenticated using (public.is_pos_user() and collected_by = auth.uid());

-- ---------- inventory ----------
create table if not exists public.inventory_adjustments (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users(id),
  category_id text not null,
  delta       integer not null,
  stock_after integer,
  reason      text not null,          -- 'sale' | 'manual' | 'set' | ...
  sale_id     uuid references public.sales(id) on delete set null,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists inventory_adjustments_created_idx on public.inventory_adjustments (created_at desc);
create unique index if not exists inventory_adjustments_one_sale_per_item
  on public.inventory_adjustments (sale_id, category_id) where reason = 'sale';
alter table public.inventory_adjustments enable row level security;
create policy "pos admin select inventory_adjustments" on public.inventory_adjustments
  for select to authenticated using (public.is_pos_admin());
create policy "pos staff select own inventory_adjustments" on public.inventory_adjustments
  for select to authenticated using (public.is_pos_user() and user_id = auth.uid());
-- no insert/update/delete policies: writes only via security definer / service role

drop policy if exists "pos user insert inventory" on public.inventory;
drop policy if exists "pos user update inventory" on public.inventory;
create policy "pos admin insert inventory" on public.inventory
  for insert to authenticated with check (public.is_pos_admin());
create policy "pos admin update inventory" on public.inventory
  for update to authenticated using (public.is_pos_admin()) with check (public.is_pos_admin());

-- Deduct stock for one sale, exactly once. Caller must be admin or the sale's seller.
create or replace function public.apply_sale_stock(p_sale_id uuid)
returns table (category_id text, stock integer)
language plpgsql security definer set search_path = public as $$
declare
  s record;
  k text;
  q integer;
  new_stock integer;
begin
  if not public.is_pos_user() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into s from public.sales where id = p_sale_id;
  if not found then
    raise exception 'sale not found';
  end if;
  if not public.is_pos_admin() and s.seller_id is distinct from auth.uid() then
    raise exception 'not your sale' using errcode = '42501';
  end if;
  if exists (select 1 from public.inventory_adjustments a
              where a.sale_id = p_sale_id and a.reason = 'sale') then
    return query select i.category_id, i.stock from public.inventory i
      where i.category_id in (select a.category_id from public.inventory_adjustments a
                               where a.sale_id = p_sale_id and a.reason = 'sale');
    return;
  end if;

  for k, q in
    select b.key, sum((b.value)::integer)
      from jsonb_array_elements(case when jsonb_typeof(s.items) = 'array' then s.items else '[]'::jsonb end) it,
           jsonb_each_text(case when jsonb_typeof(it->'breakdown') = 'object' then it->'breakdown' else '{}'::jsonb end) b
     where b.value ~ '^[0-9]+$'
     group by b.key
  loop
    continue when q <= 0;
    update public.inventory i
       set stock = greatest(0, i.stock - q), updated_at = now()
     where i.category_id = k
     returning i.stock into new_stock;
    continue when not found;
    insert into public.inventory_adjustments (user_id, category_id, delta, stock_after, reason, sale_id)
    values (auth.uid(), k, -q, new_stock, 'sale', p_sale_id);
    category_id := k; stock := new_stock;
    return next;
  end loop;
end;
$$;
revoke all on function public.apply_sale_stock(uuid) from public, anon;
grant execute on function public.apply_sale_stock(uuid) to authenticated, service_role;
