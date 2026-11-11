-- D4 offline sales queue. Additive. Do not apply until the owner approves a migration.
-- Idempotency key for a sale that was queued on the device and posted later.
alter table public.sales add column if not exists client_sale_id uuid;
create unique index if not exists sales_client_sale_id_key on public.sales (client_sale_id);
