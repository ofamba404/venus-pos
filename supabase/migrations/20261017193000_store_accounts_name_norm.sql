-- Case/whitespace-insensitive Snapchat name matching for storefront auth.
-- Verified before applying: 114 accounts, 114 distinct normalized names (no collisions).
-- Existing names are NOT changed; this only adds a derived lookup column + unique index.
alter table public.store_accounts
  add column if not exists snapchat_name_norm text
  generated always as (lower(btrim(regexp_replace(snapchat_name, '\s+', ' ', 'g')))) stored;

create unique index if not exists store_accounts_snapchat_name_norm_uidx
  on public.store_accounts (snapchat_name_norm);

comment on column public.store_accounts.snapchat_name_norm is
  'lower(trim(collapse whitespace)) of snapchat_name; store-auth looks accounts up by this. Must match normName() in store-auth.';
