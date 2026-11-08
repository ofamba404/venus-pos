-- Fix for 20261108113000: the insert policy's subquery on store_reviews
-- recursed through store_reviews RLS (42P17). Use a SECURITY DEFINER
-- helper instead. (20261108113000 has been edited to match for fresh
-- environments; this file repairs the applied version.)
--
-- Safe to re-run.

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
