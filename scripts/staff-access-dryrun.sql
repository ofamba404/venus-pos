begin;
-- Who logged / delivered / collected — set server-side so staff cannot spoof.
-- Service-role writes (auth.uid() is null) keep whatever they send.

alter table public.sales           add column if not exists seller_id    uuid references auth.users(id);
alter table public.deliveries      add column if not exists delivered_by uuid references auth.users(id);
alter table public.credit_payments add column if not exists collected_by uuid references auth.users(id);

alter table public.sales           alter column seller_id    set default auth.uid();
alter table public.deliveries      alter column delivered_by set default auth.uid();
alter table public.credit_payments alter column collected_by set default auth.uid();

create index if not exists sales_seller_created_idx on public.sales (seller_id, created_at desc);
create index if not exists deliveries_delivered_by_idx on public.deliveries (delivered_by);
create index if not exists credit_payments_collected_by_idx on public.credit_payments (collected_by);

-- Generic attribution trigger. TG_ARGV[0] = column name.
create or replace function public.trg_set_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  col text := tg_argv[0];
  actor uuid := auth.uid();
  old_val uuid;
  new_val uuid;
begin
  if actor is null then
    return new; -- service role / SQL editor
  end if;
  new_val := (to_jsonb(new) ->> col)::uuid;
  if tg_op = 'INSERT' then
    if public.is_pos_admin() then
      -- admin may attribute to a staff member explicitly; default to self
      if new_val is null then
        new := jsonb_populate_record(new, jsonb_build_object(col, actor));
      end if;
    else
      new := jsonb_populate_record(new, jsonb_build_object(col, actor));
    end if;
  elsif tg_op = 'UPDATE' then
    if not public.is_pos_admin() then
      old_val := (to_jsonb(old) ->> col)::uuid;
      new := jsonb_populate_record(new, jsonb_build_object(col, old_val));
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists sales_set_seller on public.sales;
create trigger sales_set_seller before insert or update on public.sales
  for each row execute function public.trg_set_actor('seller_id');

drop trigger if exists deliveries_set_delivered_by on public.deliveries;
create trigger deliveries_set_delivered_by before insert or update on public.deliveries
  for each row execute function public.trg_set_actor('delivered_by');

drop trigger if exists credit_payments_set_collected_by on public.credit_payments;
create trigger credit_payments_set_collected_by before insert or update on public.credit_payments
  for each row execute function public.trg_set_actor('collected_by');

-- Backfill: everything logged so far was the owner (sole pos_admin).
do $$
declare owner_id uuid;
begin
  select id into owner_id from auth.users
   where raw_app_meta_data ->> 'role' = 'pos_admin'
   order by created_at limit 1;
  if owner_id is null then
    raise exception 'No pos_admin user found for backfill';
  end if;
  update public.sales           set seller_id    = owner_id where seller_id    is null;
  update public.deliveries      set delivered_by = owner_id where delivered_by is null;
  update public.credit_payments set collected_by = owner_id where collected_by is null;
end $$;
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
-- Joint costs, staff commission rates, per-sale profit view, settlements.

create table if not exists public.joint_costs (
  category_id text primary key,
  cost_ugx    integer not null check (cost_ugx >= 0),
  updated_at  timestamptz not null default now()
);
insert into public.joint_costs (category_id, cost_ugx) values
  ('classic', 3000), ('spliff5050', 3000), ('spliff7030', 3000),
  ('mint', 5000), ('strawberry', 5000), ('blueberry', 5000), ('watermelon', 5000),
  ('grape', 5000), ('coconut', 5000), ('melon', 5000)
on conflict (category_id) do nothing;
alter table public.joint_costs enable row level security;
create policy "pos user select joint_costs" on public.joint_costs
  for select to authenticated using (public.is_pos_user());
create policy "pos admin write joint_costs" on public.joint_costs
  for all to authenticated using (public.is_pos_admin()) with check (public.is_pos_admin());

create table if not exists public.staff_commission_rates (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  rate       numeric(5,4) not null check (rate >= 0 and rate <= 1),
  updated_at timestamptz not null default now()
);
alter table public.staff_commission_rates enable row level security;
create policy "pos admin all staff_commission_rates" on public.staff_commission_rates
  for all to authenticated using (public.is_pos_admin()) with check (public.is_pos_admin());
create policy "pos staff select own rate" on public.staff_commission_rates
  for select to authenticated using (user_id = auth.uid());
-- Paris (only if the account exists)
insert into public.staff_commission_rates (user_id, rate)
select id, 0.40 from auth.users where id = 'aca877ee-fa13-4342-bbf5-80c084df58df'
on conflict (user_id) do nothing;

create table if not exists public.staff_settlements (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null references auth.users(id),
  amount_ugx   integer not null check (amount_ugx > 0),
  period_start date,
  period_end   date,
  paid_at      timestamptz not null default now(),
  note         text,
  created_by   uuid default auth.uid() references auth.users(id),
  created_at   timestamptz not null default now()
);
create index if not exists staff_settlements_staff_idx on public.staff_settlements (staff_id, paid_at desc);
alter table public.staff_settlements enable row level security;
create policy "pos admin all staff_settlements" on public.staff_settlements
  for all to authenticated using (public.is_pos_admin()) with check (public.is_pos_admin());
create policy "pos staff select own settlements" on public.staff_settlements
  for select to authenticated using (staff_id = auth.uid());

-- One row per joint-bearing sale line. Derived from items: revenue = line_total,
-- cost = sum(qty × joint_costs.cost_ugx). Lines with any non-joint key (cookies,
-- wholesale) and reward lines are excluded. security_invoker => caller's RLS applies.
create or replace view public.sale_line_joint_profit
with (security_invoker = true) as
with lines as (
  select s.id as sale_id, s.seller_id, s.created_at, s.is_credit, s.credit_cleared,
         (it.ord - 1)::int as line_index,
         it.item ->> 'product_id' as product_id,
         coalesce((it.item ->> 'line_total')::numeric, 0) as line_total,
         coalesce((it.item ->> 'is_reward')::boolean, false) as is_reward,
         case when jsonb_typeof(it.item -> 'breakdown') = 'object' then it.item -> 'breakdown' else '{}'::jsonb end as breakdown
    from public.sales s,
         jsonb_array_elements(case when jsonb_typeof(s.items) = 'array' then s.items else '[]'::jsonb end)
           with ordinality as it(item, ord)
), costed as (
  select l.*,
         (select coalesce(sum((b.value)::numeric), 0) from jsonb_each_text(l.breakdown) b
            join public.joint_costs c on c.category_id = b.key) as joint_units,
         (select coalesce(sum((b.value)::numeric * c.cost_ugx), 0) from jsonb_each_text(l.breakdown) b
            join public.joint_costs c on c.category_id = b.key) as cost_ugx,
         (select count(*) from jsonb_each_text(l.breakdown) b
            left join public.joint_costs c on c.category_id = b.key where c.category_id is null) as non_joint_keys
    from lines l
)
select c.sale_id, c.seller_id, c.created_at, c.line_index, c.product_id,
       c.joint_units, c.line_total as revenue_ugx, c.cost_ugx,
       (c.line_total - c.cost_ugx) as profit_ugx,
       coalesce(r.rate, 0) as rate,
       round(greatest(c.line_total - c.cost_ugx, 0) * coalesce(r.rate, 0)) as commission_ugx,
       (not coalesce(c.is_credit, false) or coalesce(c.credit_cleared, false)) as is_paid
  from costed c
  left join public.staff_commission_rates r on r.user_id = c.seller_id
 where c.joint_units > 0 and c.non_joint_keys = 0 and not c.is_reward;

-- Per-staff summary. Earned counts paid sales only; open credit shows as pending.
create or replace view public.staff_commission_summary
with (security_invoker = true) as
with w as (
  select date_trunc('week',  now() at time zone 'Africa/Kampala') at time zone 'Africa/Kampala' as week_start,
         date_trunc('month', now() at time zone 'Africa/Kampala') at time zone 'Africa/Kampala' as month_start
), earned as (
  select p.seller_id as staff_id,
         sum(p.commission_ugx) filter (where p.is_paid)                                   as earned_all,
         sum(p.commission_ugx) filter (where p.is_paid and p.created_at >= w.week_start)  as earned_week,
         sum(p.commission_ugx) filter (where p.is_paid and p.created_at >= w.month_start) as earned_month,
         sum(p.commission_ugx) filter (where not p.is_paid)                               as pending_credit,
         sum(p.joint_units)                                                               as joint_units_all
    from public.sale_line_joint_profit p cross join w
   where p.rate > 0
   group by p.seller_id
), paid as (
  select st.staff_id,
         sum(st.amount_ugx) as paid_all,
         sum(st.amount_ugx) filter (where st.paid_at >= w.week_start)  as paid_week,
         sum(st.amount_ugx) filter (where st.paid_at >= w.month_start) as paid_month,
         max(st.paid_at) as last_paid_at
    from public.staff_settlements st cross join w
   group by st.staff_id
)
select r.user_id as staff_id, r.rate,
       coalesce(e.earned_week, 0)  as earned_week,
       coalesce(e.earned_month, 0) as earned_month,
       coalesce(e.earned_all, 0)   as earned_all,
       coalesce(e.pending_credit, 0) as pending_credit,
       coalesce(e.joint_units_all, 0) as joint_units_all,
       coalesce(p.paid_week, 0)  as paid_week,
       coalesce(p.paid_month, 0) as paid_month,
       coalesce(p.paid_all, 0)   as paid_all,
       coalesce(e.earned_all, 0) - coalesce(p.paid_all, 0) as balance,
       p.last_paid_at
  from public.staff_commission_rates r
  left join earned e on e.staff_id = r.user_id
  left join paid   p on p.staff_id = r.user_id;

grant select on public.sale_line_joint_profit, public.staff_commission_summary to authenticated;
revoke all on public.sale_line_joint_profit, public.staff_commission_summary from anon;

-- Display labels for the owner's summary (email only; admin-only).
create or replace function public.pos_staff_directory()
returns table (user_id uuid, email text, role text)
language sql security definer set search_path = public, auth stable as $$
  select u.id, u.email::text, u.raw_app_meta_data ->> 'role'
    from auth.users u
   where public.is_pos_admin()
     and u.raw_app_meta_data ->> 'role' in ('pos_admin', 'pos_staff');
$$;
revoke all on function public.pos_staff_directory() from public, anon;
grant execute on function public.pos_staff_directory() to authenticated;
create temp table _t(k text, v jsonb) on commit drop;
grant all on _t to authenticated;
insert into _t select 'backfill_null', to_jsonb((select count(*) from sales where seller_id is null));
insert into _t select 'summary_admin_view', (select jsonb_agg(x) from staff_commission_summary x);
insert into _t select 'profit_by_product', (select jsonb_agg(x) from (select product_id, count(*) n, sum(profit_ugx) p, sum(joint_units) u from sale_line_joint_profit group by 1) x);
-- simulate Paris
select set_config('request.jwt.claims', '{"sub":"aca877ee-fa13-4342-bbf5-80c084df58df","role":"authenticated","app_metadata":{"role":"pos_staff"}}', true);
set local role authenticated;
insert into _t select 'staff_sees_sales', to_jsonb((select count(*) from sales));
with u as (update inventory set stock=stock where category_id='mint' returning 1) insert into _t select 'staff_inv_update_rows', to_jsonb((select count(*) from u));
with ins as (insert into sales(items,total_ugx,is_credit,credit_cleared,amount_paid_ugx,seller_id) values ('[{"product_id":"pilot","line_total":15000,"breakdown":{"mint":1,"grape":1}}]',15000,true,false,0,'00000000-0000-0000-0000-000000000000') returning id, seller_id)
insert into _t select 'staff_insert_seller', to_jsonb(seller_id::text) || to_jsonb(id::text) from ins;
insert into _t select 'apply_sale_stock', (select jsonb_agg(x) from apply_sale_stock(((select v->>1 from _t where k='staff_insert_seller'))::uuid) x);
insert into _t select 'apply_again', (select jsonb_agg(x) from apply_sale_stock(((select v->>1 from _t where k='staff_insert_seller'))::uuid) x);
update sales set credit_cleared=true, amount_paid_ugx=15000 where id=((select v->>1 from _t where k='staff_insert_seller'))::uuid;
insert into _t select 'after_staff_clear', (select to_jsonb(s) - 'items' from (select credit_cleared, amount_paid_ugx from sales where id=((select v->>1 from _t where k='staff_insert_seller'))::uuid) s);
insert into _t select 'staff_summary', (select jsonb_agg(x) from staff_commission_summary x);
with d as (delete from sales where id=((select v->>1 from _t where k='staff_insert_seller'))::uuid returning 1) insert into _t select 'staff_delete_rows', to_jsonb((select count(*) from d));
reset role;
do $$ begin raise exception 'TEST_RESULT %', (select jsonb_object_agg(k, v) from _t); end $$;
