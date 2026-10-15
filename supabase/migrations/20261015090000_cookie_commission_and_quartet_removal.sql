-- Cookie commission + Cookie Quartet removal.
-- Single source of truth for cookie economics: public.cookie_costs + public.commission_settings.
-- js/config.js loads these at boot (js/cookie-economics.js); the JS constants are only offline fallbacks.

create table if not exists public.cookie_costs (
  category_id   text primary key,
  wholesale_ugx numeric not null check (wholesale_ugx >= 0),
  unit_price_ugx numeric not null check (unit_price_ugx >= 0),  -- a-la-carte weight for single-line allocation
  updated_at timestamptz not null default now()
);
insert into public.cookie_costs (category_id, wholesale_ugx, unit_price_ugx) values
  ('cookie_butterscotch', 2500, 5000),
  ('cookie_chocolate',    3000, 8000),
  ('cookie_mint',         3000, 8000),
  ('cookie_strawberry',   3000, 8000),
  ('cookie',              2500, 5000)   -- legacy aggregate key = butterscotch
on conflict (category_id) do nothing;

create table if not exists public.commission_settings (
  key text primary key,
  value numeric not null,
  updated_at timestamptz not null default now()
);
insert into public.commission_settings (key, value) values ('owner_cookie_share', 0.45)
on conflict (key) do nothing;

alter table public.cookie_costs enable row level security;
alter table public.commission_settings enable row level security;
create policy "pos user select cookie_costs" on public.cookie_costs for select to authenticated using (public.is_pos_user());
create policy "pos admin write cookie_costs" on public.cookie_costs for all to authenticated using (public.is_pos_admin()) with check (public.is_pos_admin());
create policy "pos user select commission_settings" on public.commission_settings for select to authenticated using (public.is_pos_user());
create policy "pos admin write commission_settings" on public.commission_settings for all to authenticated using (public.is_pos_admin()) with check (public.is_pos_admin());
revoke all on public.cookie_costs, public.commission_settings from anon;
grant select on public.cookie_costs, public.commission_settings to authenticated;
grant insert, update, delete on public.cookie_costs, public.commission_settings to authenticated;

-- Per-line cookie profit, allocated like revenue.js allocateCookieLineRevenue:
--   packs (duet/trio/legacy quartet): line_total split evenly per cookie;
--   singles: weighted by unit_price × qty.
-- Owner share = Σ max(alloc − qty×wholesale, 0) × owner_cookie_share; commission = owner share × rate.
-- Excludes wholesale lines, rewards, zero-revenue lines and lines mixing cookie + non-cookie keys.
create or replace view public.sale_line_cookie_profit
with (security_invoker = true) as
with lines as (
  select s.id as sale_id, s.seller_id, s.created_at, s.is_credit, s.credit_cleared,
         (it.ord - 1)::int as line_index,
         it.item ->> 'product_id' as product_id,
         lower(coalesce(it.item ->> 'product_id', '') || ' ' || coalesce(it.item ->> 'product_name', '')) as ident,
         coalesce((it.item ->> 'line_total')::numeric, 0) as line_total,
         coalesce((it.item ->> 'is_reward')::boolean, false) or coalesce(it.item ->> 'reward_key', '') <> '' as is_reward,
         case when jsonb_typeof(it.item -> 'breakdown') = 'object' then it.item -> 'breakdown' else '{}'::jsonb end as breakdown
    from public.sales s,
         jsonb_array_elements(case when jsonb_typeof(s.items) = 'array' then s.items else '[]'::jsonb end)
           with ordinality as it(item, ord)
), entries as (
  select l.sale_id, l.line_index, b.key as category_id, (b.value)::numeric as qty, c.wholesale_ugx, c.unit_price_ugx
    from lines l
    cross join lateral jsonb_each_text(l.breakdown) b
    join public.cookie_costs c on c.category_id = b.key
   where (b.value) ~ '^[0-9.]+$' and (b.value)::numeric > 0
), line_stats as (
  select l.*,
         (l.ident ~ '(duet|trio|quartet)') as is_pack,
         (select coalesce(sum(e.qty), 0) from entries e where e.sale_id = l.sale_id and e.line_index = l.line_index) as cookie_units,
         (select coalesce(sum(e.qty * e.unit_price_ugx), 0) from entries e where e.sale_id = l.sale_id and e.line_index = l.line_index) as weight_sum,
         (select count(*) from jsonb_each_text(l.breakdown) b
            left join public.cookie_costs c on c.category_id = b.key where c.category_id is null) as non_cookie_keys
    from lines l
), alloc as (
  select ls.sale_id, ls.line_index,
         e.qty * e.wholesale_ugx as cost,
         case when ls.is_pack or ls.weight_sum = 0 then ls.line_total * e.qty / ls.cookie_units
              else ls.line_total * e.qty * e.unit_price_ugx / ls.weight_sum end as alloc
    from line_stats ls
    join entries e on e.sale_id = ls.sale_id and e.line_index = ls.line_index
   where ls.cookie_units > 0
), per_line as (
  select sale_id, line_index, sum(cost) as cost_ugx, sum(greatest(alloc - cost, 0)) as pos_profit
    from alloc group by sale_id, line_index
)
select ls.sale_id, ls.seller_id, ls.created_at, ls.line_index, ls.product_id,
       ls.cookie_units, ls.line_total as revenue_ugx, pl.cost_ugx,
       (ls.line_total - pl.cost_ugx) as profit_ugx,
       round(pl.pos_profit * cs.value) as owner_share_ugx,
       coalesce(r.rate, 0) as rate,
       round(pl.pos_profit * cs.value * coalesce(r.rate, 0)) as commission_ugx,
       (not coalesce(ls.is_credit, false) or coalesce(ls.credit_cleared, false)) as is_paid
  from line_stats ls
  join per_line pl on pl.sale_id = ls.sale_id and pl.line_index = ls.line_index
  cross join (select value from public.commission_settings where key = 'owner_cookie_share') cs
  left join public.staff_commission_rates r on r.user_id = ls.seller_id
 where ls.cookie_units > 0 and ls.non_cookie_keys = 0 and not ls.is_reward
   and ls.line_total > 0 and ls.ident not like '%wholesale%';

-- Summary: existing columns keep their meaning but now = joints + cookies; breakdown appended.
create or replace view public.staff_commission_summary
with (security_invoker = true) as
with w as (
  select date_trunc('week',  now() at time zone 'Africa/Kampala') at time zone 'Africa/Kampala' as week_start,
         date_trunc('month', now() at time zone 'Africa/Kampala') at time zone 'Africa/Kampala' as month_start
), lines as (
  select seller_id, created_at, is_paid, commission_ugx, joint_units, 0::numeric as cookie_units, 'joint' as kind, rate
    from public.sale_line_joint_profit
  union all
  select seller_id, created_at, is_paid, commission_ugx, 0, cookie_units, 'cookie', rate
    from public.sale_line_cookie_profit
), earned as (
  select p.seller_id as staff_id,
         sum(p.commission_ugx) filter (where p.is_paid)                                   as earned_all,
         sum(p.commission_ugx) filter (where p.is_paid and p.created_at >= w.week_start)  as earned_week,
         sum(p.commission_ugx) filter (where p.is_paid and p.created_at >= w.month_start) as earned_month,
         sum(p.commission_ugx) filter (where not p.is_paid)                               as pending_credit,
         sum(p.joint_units)                                                               as joint_units_all,
         sum(p.commission_ugx) filter (where p.is_paid and p.kind = 'joint')  as joint_earned_all,
         sum(p.commission_ugx) filter (where p.is_paid and p.kind = 'cookie') as cookie_earned_all,
         sum(p.commission_ugx) filter (where p.is_paid and p.kind = 'joint'  and p.created_at >= w.week_start)  as joint_earned_week,
         sum(p.commission_ugx) filter (where p.is_paid and p.kind = 'cookie' and p.created_at >= w.week_start)  as cookie_earned_week,
         sum(p.commission_ugx) filter (where p.is_paid and p.kind = 'joint'  and p.created_at >= w.month_start) as joint_earned_month,
         sum(p.commission_ugx) filter (where p.is_paid and p.kind = 'cookie' and p.created_at >= w.month_start) as cookie_earned_month,
         sum(p.commission_ugx) filter (where not p.is_paid and p.kind = 'joint')  as joint_pending_credit,
         sum(p.commission_ugx) filter (where not p.is_paid and p.kind = 'cookie') as cookie_pending_credit,
         sum(p.cookie_units) as cookie_units_all
    from lines p cross join w
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
       p.last_paid_at,
       coalesce(e.joint_earned_week, 0)   as joint_earned_week,
       coalesce(e.cookie_earned_week, 0)  as cookie_earned_week,
       coalesce(e.joint_earned_month, 0)  as joint_earned_month,
       coalesce(e.cookie_earned_month, 0) as cookie_earned_month,
       coalesce(e.joint_earned_all, 0)    as joint_earned_all,
       coalesce(e.cookie_earned_all, 0)   as cookie_earned_all,
       coalesce(e.joint_pending_credit, 0)  as joint_pending_credit,
       coalesce(e.cookie_pending_credit, 0) as cookie_pending_credit,
       coalesce(e.cookie_units_all, 0)    as cookie_units_all
  from public.staff_commission_rates r
  left join earned e on e.staff_id = r.user_id
  left join paid   p on p.staff_id = r.user_id;

grant select on public.sale_line_cookie_profit, public.staff_commission_summary to authenticated;
revoke all on public.sale_line_cookie_profit, public.staff_commission_summary from anon;

-- Cookie Quartet removal: no FKs reference store_product_prices; historical sales keep their own
-- line totals in sales.items, so deleting the trusted price only makes new Quartet store orders
-- get flagged for review.
delete from public.store_product_prices where product_id = 'cookie-quartet';

-- Drop Quartet from the store-order bulk-price allowance (exact in-place edit of the live function).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.recompute_store_order_totals'::regproc);
  if position(', "cookie-quartet": 3' in d) > 0 then
    execute replace(d, ', "cookie-quartet": 3', '');
  end if;
end $$;
