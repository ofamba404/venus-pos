-- One review per customer account, enforced in the database.
--
-- Project ref xiangrykfxlnacthjcad (venus-pos-inventory).
--
-- Checked before applying: no account had more than one store_reviews row
-- and no row had a null account_id, so the unique index is safe.
--
-- Three layers:
-- 1. Unique index on store_reviews(account_id).
-- 2. Guard trigger raises a friendly error before the insert.
-- 3. Insert RLS policy also requires the caller to have no review yet.
--
-- If the owner deletes someone's review in POS, that person can leave a
-- new one, but the review bonus (review_bonus:<account_id>) never pays
-- twice.
--
-- Safe to re-run.

create unique index if not exists store_reviews_one_per_account_uidx
  on public.store_reviews (account_id);

create or replace function private.store_reviews_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  pending_count integer;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is null then
      raise exception 'Sign in to leave a review.' using errcode = '42501';
    end if;

    if exists (
      select 1 from public.store_reviews r where r.account_id = auth.uid()
    ) then
      raise exception 'You’ve already left a review. Thank you!'
        using errcode = '23505', hint = 'already_reviewed';
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
    new.page_path := old.page_path;

    -- Owner may correct the public display name (never the account).
    if new.display_name is distinct from old.display_name then
      new.display_name := pg_catalog.btrim(coalesce(new.display_name, ''));
      new.display_name := pg_catalog.regexp_replace(new.display_name, '\s+', ' ', 'g');
      if pg_catalog.char_length(new.display_name) < 1 then
        raise exception 'Display name can''t be empty.';
      end if;
      if pg_catalog.char_length(new.display_name) > 40 then
        raise exception 'Display name must be 40 characters or fewer.';
      end if;
      new.customer_name := new.display_name;
    else
      new.display_name := old.display_name;
      new.customer_name := old.customer_name;
    end if;

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
$function$;

-- SECURITY DEFINER lookup so the insert policy doesn't re-enter
-- store_reviews RLS (a plain subquery there recurses).
create or replace function private.store_reviews_has_own()
 returns boolean
 language sql
 stable
 security definer
 set search_path to ''
as $$
  select exists (
    select 1 from public.store_reviews r where r.account_id = auth.uid()
  );
$$;

revoke all on function private.store_reviews_has_own() from public, anon;
grant execute on function private.store_reviews_has_own() to authenticated;

drop policy if exists store_reviews_insert_own on public.store_reviews;
create policy store_reviews_insert_own on public.store_reviews
  for insert to authenticated
  with check (
    account_id = (select auth.uid())
    and status = 'pending'
    and rating between 1 and 5
    and char_length(btrim(display_name)) between 1 and 40
    and char_length(btrim(body)) between 1 and 500
    and not (select private.store_reviews_has_own())
  );
