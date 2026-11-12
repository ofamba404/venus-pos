-- Flavored joint cost drops from 5,000 to 4,000 UGX, FORWARD-ONLY.
-- Before: sale_line_joint_profit priced every line at the live joint_costs value,
-- so editing joint_costs would have rewritten all past profit/commission.
-- Now: costs are effective-dated in joint_cost_history and each sale line is
-- costed at the cost in force at sales.created_at. Past sales keep 5,000.
-- joint_costs stays the "current cost" (and the set of joint category keys);
-- the staff price list in the POS reads it.

create table if not exists public.joint_cost_history (
  category_id    text        not null references public.joint_costs(category_id) on delete cascade,
  cost_ugx       integer     not null check (cost_ugx >= 0),
  effective_from timestamptz not null,
  primary key (category_id, effective_from)
);

alter table public.joint_cost_history enable row level security;
create policy "pos user select joint_cost_history" on public.joint_cost_history
  for select to authenticated using (public.is_pos_user());
create policy "pos admin write joint_cost_history" on public.joint_cost_history
  for all to authenticated using (public.is_pos_admin()) with check (public.is_pos_admin());
revoke all on public.joint_cost_history from anon;
grant select, insert, update, delete on public.joint_cost_history to authenticated;

-- Baseline: every category at its current (pre-change) cost since forever.
insert into public.joint_cost_history (category_id, cost_ugx, effective_from)
select category_id, cost_ugx, 'epoch'::timestamptz from public.joint_costs
on conflict do nothing;

-- New flavored cost, effective from now (2026-11-11 15:37 UTC = 18:37 EAT).
insert into public.joint_cost_history (category_id, cost_ugx, effective_from)
select category_id, 4000, '2026-11-11 15:37:00+00'::timestamptz
from public.joint_costs
where category_id in ('mint','strawberry','blueberry','watermelon','grape','coconut','melon')
on conflict do nothing;

update public.joint_costs set cost_ugx = 4000, updated_at = now()
where category_id in ('mint','strawberry','blueberry','watermelon','grape','coconut','melon');

create or replace view public.sale_line_joint_profit as
 WITH lines AS (
         SELECT s.id AS sale_id,
            s.seller_id,
            s.created_at,
            s.is_credit,
            s.credit_cleared,
            ((it.ord - 1))::integer AS line_index,
            (it.item ->> 'product_id'::text) AS product_id,
            COALESCE(((it.item ->> 'line_total'::text))::numeric, (0)::numeric) AS line_total,
            COALESCE(((it.item ->> 'is_reward'::text))::boolean, false) AS is_reward,
                CASE
                    WHEN (jsonb_typeof((it.item -> 'breakdown'::text)) = 'object'::text) THEN (it.item -> 'breakdown'::text)
                    ELSE '{}'::jsonb
                END AS breakdown
           FROM sales s,
            LATERAL jsonb_array_elements(
                CASE
                    WHEN (jsonb_typeof(s.items) = 'array'::text) THEN s.items
                    ELSE '[]'::jsonb
                END) WITH ORDINALITY it(item, ord)
        ), costed AS (
         SELECT l.sale_id,
            l.seller_id,
            l.created_at,
            l.is_credit,
            l.credit_cleared,
            l.line_index,
            l.product_id,
            l.line_total,
            l.is_reward,
            l.breakdown,
            ( SELECT COALESCE(sum((b.value)::numeric), (0)::numeric) AS "coalesce"
                   FROM (jsonb_each_text(l.breakdown) b(key, value)
                     JOIN joint_costs c_1 ON ((c_1.category_id = b.key)))) AS joint_units,
            ( SELECT COALESCE(sum(((b.value)::numeric * (COALESCE(
                        ( SELECT h.cost_ugx
                           FROM joint_cost_history h
                          WHERE h.category_id = c_1.category_id AND h.effective_from <= l.created_at
                          ORDER BY h.effective_from DESC
                         LIMIT 1), c_1.cost_ugx))::numeric)), (0)::numeric) AS "coalesce"
                   FROM (jsonb_each_text(l.breakdown) b(key, value)
                     JOIN joint_costs c_1 ON ((c_1.category_id = b.key)))) AS cost_ugx,
            ( SELECT count(*) AS count
                   FROM (jsonb_each_text(l.breakdown) b(key, value)
                     LEFT JOIN joint_costs c_1 ON ((c_1.category_id = b.key)))
                  WHERE (c_1.category_id IS NULL)) AS non_joint_keys
           FROM lines l
        )
 SELECT c.sale_id,
    c.seller_id,
    c.created_at,
    c.line_index,
    c.product_id,
    c.joint_units,
    c.line_total AS revenue_ugx,
    c.cost_ugx,
    (c.line_total - c.cost_ugx) AS profit_ugx,
    COALESCE(r.rate, (0)::numeric) AS rate,
    round((GREATEST((c.line_total - c.cost_ugx), (0)::numeric) * COALESCE(r.rate, (0)::numeric))) AS commission_ugx,
    ((NOT COALESCE(c.is_credit, false)) OR COALESCE(c.credit_cleared, false)) AS is_paid
   FROM (costed c
     LEFT JOIN staff_commission_rates r ON ((r.user_id = c.seller_id)))
  WHERE ((c.joint_units > (0)::numeric) AND (c.non_joint_keys = 0) AND (NOT c.is_reward));

alter view public.sale_line_joint_profit set (security_invoker = true);
