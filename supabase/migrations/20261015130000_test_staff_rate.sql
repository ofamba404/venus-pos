-- Commission rate for the test staff login (test-staff@venus.local) so the card renders.
insert into public.staff_commission_rates (user_id, rate)
values ('f8047e15-aad0-4d0d-9737-2a2c17fe39de', 0.40)
on conflict (user_id) do update set rate = excluded.rate;
