-- Hide test staff from the owner's commission summary without hardcoding emails in the UI.
alter table public.staff_commission_rates add column if not exists is_hidden boolean not null default false;
update public.staff_commission_rates set is_hidden = true where user_id = 'f8047e15-aad0-4d0d-9737-2a2c17fe39de'; -- test-staff@venus.local
