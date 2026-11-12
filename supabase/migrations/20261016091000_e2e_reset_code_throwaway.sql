-- E2E test only: reset code for throwaway customer zz-resettest-22cdb5 (deleted after test).
insert into public.store_reset_codes (user_id, code_hash, issued_by)
select 'aa8258ad-b34b-4686-b93e-07277cd76577', '395b3741cb328155ee6958d6a65974f25b2cd5c862e0af315dae4c209bb2eac1', '0cddbf3f-dad5-41f3-8516-1ac47b049f01'
where exists (select 1 from public.store_accounts where id = 'aa8258ad-b34b-4686-b93e-07277cd76577' and snapchat_name = 'zz-resettest-22cdb5');
insert into public.store_reset_audit (user_id, event, actor_id, detail) values ('aa8258ad-b34b-4686-b93e-07277cd76577', 'issued', '0cddbf3f-dad5-41f3-8516-1ac47b049f01', 'e2e test');
