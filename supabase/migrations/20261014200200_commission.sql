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
