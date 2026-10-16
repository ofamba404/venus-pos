-- Remove the throwaway E2E customer (zz-resettest-22cdb5) and its test rows.
do $$
declare v uuid := 'aa8258ad-b34b-4686-b93e-07277cd76577';
begin
  if not exists (select 1 from public.store_accounts where id = v and snapchat_name = 'zz-resettest-22cdb5') then
    raise exception 'throwaway account not found — abort';
  end if;
  delete from public.store_reset_audit where user_id = v;
  delete from public.store_reset_codes where user_id = v;
  delete from public.store_accounts where id = v;
  delete from auth.users where id = v;
end $$;
