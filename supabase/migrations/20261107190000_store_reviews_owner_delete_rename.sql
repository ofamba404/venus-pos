-- Store reviews: the owner (POS admin) can delete a review and edit its
-- public display name. Follows 20261107120000_store_reviews_moderation.sql,
-- which must be applied first.
--
-- NOT APPLIED. Run it in the Supabase SQL editor for venus-pos-inventory
-- (project ref xiangrykfxlnacthjcad) only after the owner approves.
--
-- - Delete: owner-only RLS delete policy. Staff and customers still can't delete.
-- - Rename: owner-only update of display_name on the review row. The customer's
--   account is not touched. Same rule as the storefront form: trimmed, spaces
--   collapsed, 1-40 characters. customer_name is kept in step with it.
-- - Approve / hide behave exactly as before.
--
-- Safe to re-run.

-- Delete ----------------------------------------------------------------
grant delete on public.store_reviews to authenticated;

drop policy if exists store_reviews_admin_delete on public.store_reviews;
create policy store_reviews_admin_delete
  on public.store_reviews
  for delete
  to authenticated
  using ((select public.is_pos_admin()));

-- Rename ----------------------------------------------------------------
-- Column-level grant: the update policy (admin only) still gates the row.
grant update (status, display_name) on public.store_reviews to authenticated;

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
    new.display_name := pg_catalog.btrim(coalesce(new.display_name, ''));
    new.display_name := pg_catalog.regexp_replace(new.display_name, '\s+', ' ', 'g');
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
$$;

revoke all on function private.store_reviews_guard() from public;
grant execute on function private.store_reviews_guard() to authenticated, service_role;
