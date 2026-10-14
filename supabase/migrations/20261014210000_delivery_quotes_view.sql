-- Non-PII delivery quote rows for the SafeBoda fee model (storefront + staff).
-- Drop-off coordinates rounded to 3 dp (~110 m). No names, labels, sale or client ids.
create or replace view public.delivery_fee_quotes as
select d.distance_km,
       d.duration_min,
       d.fee_ugx,
       d.created_at,
       round(d.dest_lat::numeric, 3)::double precision as dest_lat,
       round(d.dest_lng::numeric, 3)::double precision as dest_lng
  from public.deliveries d
 where d.distance_km is not null and d.fee_ugx is not null;
revoke all on public.delivery_fee_quotes from public;
grant select on public.delivery_fee_quotes to anon, authenticated, service_role;
