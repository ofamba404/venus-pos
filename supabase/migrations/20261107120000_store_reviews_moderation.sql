-- Store-wide reviews: signed-in customers submit pending notes,
-- anyone can read approved notes, only a POS admin can moderate.
--
-- Run this once in the Supabase SQL editor for venus-pos-inventory
-- (project ref xiangrykfxlnacthjcad). Do not apply it from a deploy,
-- and do not run it against production from the storefront.
-- It pairs with venus-store pull request #1, which is the shop side
-- of the same review flow.
--
-- Existing rows are already public in the POS inbox. They are marked
-- approved so they stay on the site. New inserts default to pending.
--
-- The live table already has store_reviews_rating_check (1–5) and
-- store_reviews_body_check (1–1000). This keeps the rating check and
-- replaces the body check with a 500-character cap. If any note is
-- longer than 500 characters, shorten it before running this.
--
-- Safe to re-run.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to postgres, service_role, authenticated;

alter table public.store_reviews
  add column if not exists display_name text,
  add column if not exists status text,
  add column if not exists moderated_at timestamptz,
  add column if not exists moderated_by uuid;

drop trigger if exists store_reviews_guard on public.store_reviews;

update public.store_reviews
set
  display_name = coalesce(
    nullif(btrim(display_name), ''),
    nullif(btrim(customer_name), ''),
    'Customer'
  ),
  customer_name = coalesce(
    nullif(btrim(customer_name), ''),
    nullif(btrim(display_name), ''),
    'Customer'
  ),
  status = coalesce(status, 'approved')
where display_name is null
   or btrim(display_name) = ''
   or customer_name is null
   or btrim(customer_name) = ''
   or status is null;

alter table public.store_reviews
  alter column status set default 'pending';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'store_reviews_status_check'
      and conrelid = 'public.store_reviews'::regclass
  ) then
    alter table public.store_reviews
      add constraint store_reviews_status_check
      check (status in ('pending', 'approved', 'hidden'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'store_reviews_display_name_len'
      and conrelid = 'public.store_reviews'::regclass
  ) then
    alter table public.store_reviews
      add constraint store_reviews_display_name_len
      check (char_length(display_name) between 1 and 40);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'store_reviews_body_len'
      and conrelid = 'public.store_reviews'::regclass
  ) then
    alter table public.store_reviews
      add constraint store_reviews_body_len
      check (char_length(body) between 1 and 500);
  end if;

  -- The older check allowed 1000 characters. The 500-character check
  -- is the storefront rule, so the looser one should not remain.
  if exists (
    select 1 from pg_constraint
    where conname = 'store_reviews_body_len'
      and conrelid = 'public.store_reviews'::regclass
  ) and exists (
    select 1 from pg_constraint
    where conname = 'store_reviews_body_check'
      and conrelid = 'public.store_reviews'::regclass
  ) then
    alter table public.store_reviews drop constraint store_reviews_body_check;
  end if;
end $$;

alter table public.store_reviews alter column display_name set not null;
alter table public.store_reviews alter column status set not null;

comment on column public.store_reviews.display_name is
  'Name the customer chose to show publicly. Not their login.';
comment on column public.store_reviews.status is
  'pending until a POS admin approves or hides the note.';

create index if not exists store_reviews_approved_created_idx
  on public.store_reviews (created_at desc)
  where status = 'approved';

create index if not exists store_reviews_pending_created_idx
  on public.store_reviews (created_at desc)
  where status = 'pending';

create index if not exists store_reviews_account_id_idx
  on public.store_reviews (account_id);

-- Guard runs as the owner so it can stamp account_id / status even when
-- those columns are not writable by the customer role. Lives in private
-- so PostgREST does not expose it as an RPC.
create or replace function private.store_reviews_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pending_count integer;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is null then
      raise exception 'Sign in to leave a review.' using errcode = '42501';
    end if;

    new.id := coalesce(new.id, gen_random_uuid());
    new.created_at := pg_catalog.now();
    new.account_id := auth.uid();
    new.status := 'pending';
    new.moderated_at := null;
    new.moderated_by := null;
    -- The live storefront (before venus-store PR #1 ships) sends only
    -- customer_name, so fall back to it, then to 'Customer'.
    new.display_name := pg_catalog.btrim(coalesce(
      nullif(pg_catalog.btrim(coalesce(new.display_name, '')), ''),
      pg_catalog.left(pg_catalog.btrim(coalesce(new.customer_name, '')), 40),
      ''
    ));
    new.display_name := pg_catalog.regexp_replace(new.display_name, '\s+', ' ', 'g');
    if new.display_name = '' then
      new.display_name := 'Customer';
    end if;
    new.customer_name := new.display_name;
    new.body := pg_catalog.btrim(coalesce(new.body, ''));
    new.page_path := nullif(pg_catalog.left(pg_catalog.btrim(coalesce(new.page_path, '')), 240), '');

    if new.rating is null or new.rating < 1 or new.rating > 5 then
      raise exception 'Choose a rating from 1 to 5.';
    end if;
    if pg_catalog.char_length(new.display_name) < 1
       or pg_catalog.char_length(new.display_name) > 40 then
      raise exception 'Add a display name (40 characters or fewer).';
    end if;
    if pg_catalog.char_length(new.body) < 1
       or pg_catalog.char_length(new.body) > 500 then
      raise exception 'Write a short review (500 characters or fewer).';
    end if;

    select count(*) into pending_count
    from public.store_reviews
    where account_id = auth.uid()
      and status = 'pending';

    if pending_count >= 3 then
      raise exception 'You already have reviews waiting for approval.';
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    if not public.is_pos_admin() then
      raise exception 'Only the store owner can moderate reviews.' using errcode = '42501';
    end if;
    if new.status is null or new.status not in ('pending', 'approved', 'hidden') then
      raise exception 'Unknown review status.';
    end if;

    new.id := old.id;
    new.created_at := old.created_at;
    new.account_id := old.account_id;
    new.rating := old.rating;
    new.body := old.body;
    new.display_name := old.display_name;
    new.customer_name := old.customer_name;
    new.page_path := old.page_path;

    if new.status is distinct from old.status then
      new.moderated_at := pg_catalog.now();
      new.moderated_by := auth.uid();
    else
      new.moderated_at := old.moderated_at;
      new.moderated_by := old.moderated_by;
    end if;

    return new;
  end if;

  return new;
end;
$$;

revoke all on function private.store_reviews_guard() from public;
grant execute on function private.store_reviews_guard() to authenticated, service_role;

create trigger store_reviews_guard
  before insert or update on public.store_reviews
  for each row execute function private.store_reviews_guard();

create or replace function public.store_review_summary()
returns table (average numeric, review_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    round(avg(rating)::numeric, 1) as average,
    count(*)::bigint as review_count
  from public.store_reviews
  where status = 'approved';
$$;

revoke all on function public.store_review_summary() from public;
grant execute on function public.store_review_summary() to anon, authenticated, service_role;

revoke delete, truncate, trigger, references on public.store_reviews from anon, authenticated;
revoke insert, update on public.store_reviews from anon;

revoke insert, update on public.store_reviews from authenticated;
-- account_id is accepted only because the live storefront still sends it;
-- the guard trigger always overwrites it with auth.uid().
grant insert (rating, body, display_name, customer_name, page_path, account_id)
  on public.store_reviews to authenticated;
grant update (status) on public.store_reviews to authenticated;
grant select on public.store_reviews to anon, authenticated;

alter table public.store_reviews enable row level security;
alter table public.store_reviews force row level security;

drop policy if exists store_reviews_insert on public.store_reviews;
drop policy if exists store_reviews_select on public.store_reviews;
drop policy if exists store_reviews_insert_own on public.store_reviews;
drop policy if exists store_reviews_select_approved on public.store_reviews;
drop policy if exists store_reviews_select_own on public.store_reviews;
drop policy if exists store_reviews_select_staff on public.store_reviews;
drop policy if exists store_reviews_admin_update on public.store_reviews;

create policy store_reviews_insert_own
  on public.store_reviews
  for insert
  to authenticated
  with check (
    account_id = (select auth.uid())
    and status = 'pending'
    and rating between 1 and 5
    and char_length(btrim(display_name)) between 1 and 40
    and char_length(btrim(body)) between 1 and 500
  );

create policy store_reviews_select_approved
  on public.store_reviews
  for select
  to anon, authenticated
  using (status = 'approved');

create policy store_reviews_select_own
  on public.store_reviews
  for select
  to authenticated
  using (account_id = (select auth.uid()));

-- Keeps the existing Venus POS inbox working for staff.
-- Approve / hide stays admin-only.
create policy store_reviews_select_staff
  on public.store_reviews
  for select
  to authenticated
  using ((select public.is_pos_user()));

create policy store_reviews_admin_update
  on public.store_reviews
  for update
  to authenticated
  using ((select public.is_pos_admin()))
  with check ((select public.is_pos_admin()));
