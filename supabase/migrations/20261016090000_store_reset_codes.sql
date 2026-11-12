-- Admin-issued one-time password reset codes for storefront customers (not a master key).
-- Codes are stored only as SHA-256 hashes; 24h expiry; single use; issuing a new code revokes prior ones.
-- Only the store-auth edge function (service role) reads/writes these tables.
create table if not exists public.store_reset_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  issued_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists store_reset_codes_user_idx on public.store_reset_codes (user_id, created_at desc);

create table if not exists public.store_reset_audit (
  id bigint generated always as identity primary key,
  user_id uuid,
  event text not null check (event in ('issued', 'used', 'failed', 'rate_limited')),
  actor_id uuid,
  code_id uuid,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists store_reset_audit_user_idx on public.store_reset_audit (user_id, event, created_at desc);

alter table public.store_reset_codes enable row level security;
alter table public.store_reset_audit enable row level security;
-- No policies for anon/authenticated: service role only. Admin can read the audit log.
create policy "pos admin read store_reset_audit" on public.store_reset_audit for select to authenticated using (public.is_pos_admin());
revoke all on public.store_reset_codes, public.store_reset_audit from anon, authenticated;
grant select on public.store_reset_audit to authenticated;
