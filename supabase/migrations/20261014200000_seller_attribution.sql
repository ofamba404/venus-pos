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
