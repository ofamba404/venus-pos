-- Rewards: 2,500 points for leaving a store review (once per account).
--
-- Project ref xiangrykfxlnacthjcad (venus-pos-inventory).
--
-- * Adds ledger kind 'review_bonus' to store_rewards_ledger.
-- * AFTER INSERT trigger on store_reviews credits the reviewer through
--   public.rewards_apply_delta (same path as order_earn / referral_bonus),
--   so points are written server-side only. Customers cannot call
--   rewards_apply_delta (service_role / postgres only).
-- * Idempotency key 'review_bonus:<account_id>' = at most one review
--   bonus per account for its lifetime, even if a review is deleted and
--   they leave another.
-- * The award is best-effort: if it fails, the review still saves and a
--   warning is logged (a reward bug must never block a review).
-- * Backfill: every account that already has a store_reviews row gets
--   the same bonus once (skipped if they already have it).
-- * get_rewards_summary config gains review_bonus: 2500.
--
-- Safe to re-run.

alter table public.store_rewards_ledger
  drop constraint if exists store_rewards_ledger_kind_check;
alter table public.store_rewards_ledger
  add constraint store_rewards_ledger_kind_check check (kind = any (array[
    'order_earn', 'referral_kickback', 'referral_bonus', 'review_bonus',
    'redeem', 'redeem_refund', 'expire', 'adjust'
  ]::text[]));

create schema if not exists private;

create or replace function private.store_reviews_award_bonus()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.account_id is null then
    return null;
  end if;
  if not exists (select 1 from public.store_accounts a where a.id = new.account_id) then
    return null;
  end if;

  begin
    perform public.rewards_apply_delta(
      new.account_id,
      2500,
      'review_bonus',
      'review_bonus:' || new.account_id::text,
      null,
      pg_catalog.jsonb_build_object('review_id', new.id, 'bonus', 2500)
    );
  exception when others then
    raise warning 'review_bonus award failed for review %: %', new.id, sqlerrm;
  end;

  return null;
end;
$$;

revoke all on function private.store_reviews_award_bonus() from public, anon, authenticated;

drop trigger if exists store_reviews_award_bonus on public.store_reviews;
create trigger store_reviews_award_bonus
  after insert on public.store_reviews
  for each row execute function private.store_reviews_award_bonus();

-- Backfill: one bonus per existing reviewer (earliest review is recorded).
do $$
declare
  v_row record;
begin
  for v_row in
    select distinct on (r.account_id) r.account_id, r.id as review_id
    from public.store_reviews r
    join public.store_accounts a on a.id = r.account_id
    where r.account_id is not null
    order by r.account_id, r.created_at
  loop
    perform public.rewards_apply_delta(
      v_row.account_id,
      2500,
      'review_bonus',
      'review_bonus:' || v_row.account_id::text,
      null,
      jsonb_build_object('review_id', v_row.review_id, 'bonus', 2500, 'backfill', true)
    );
  end loop;
end;
$$;

-- Expose the review bonus in the rewards summary config.
CREATE OR REPLACE FUNCTION public.get_rewards_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_balance integer := 0;
  v_earned integer := 0;
  v_redeemed integer := 0;
  v_history jsonb := '[]'::jsonb;
  v_month_kick integer := 0;
  v_next_expiry timestamptz;
  v_expiring_30d integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  PERFORM rewards_ensure_balance(v_uid);
  PERFORM rewards_expire_stale(v_uid);

  SELECT balance, lifetime_earned, lifetime_redeemed
  INTO v_balance, v_earned, v_redeemed
  FROM store_rewards_balances
  WHERE account_id = v_uid;

  SELECT COALESCE(sum(delta), 0)::integer INTO v_month_kick
  FROM store_rewards_ledger
  WHERE account_id = v_uid
    AND kind = 'referral_kickback'
    AND created_at >= date_trunc('month', timezone('utc', now()));

  SELECT min(expires_at) INTO v_next_expiry
  FROM store_rewards_ledger
  WHERE account_id = v_uid
    AND remaining > 0
    AND expires_at IS NOT NULL
    AND expires_at > timezone('utc', now());

  SELECT COALESCE(sum(remaining), 0)::integer INTO v_expiring_30d
  FROM store_rewards_ledger
  WHERE account_id = v_uid
    AND remaining > 0
    AND expires_at IS NOT NULL
    AND expires_at > timezone('utc', now())
    AND expires_at <= timezone('utc', now()) + interval '30 days';

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC), '[]'::jsonb)
  INTO v_history
  FROM (
    SELECT id, delta, balance_after, kind, order_id, meta, created_at, expires_at, remaining
    FROM store_rewards_ledger
    WHERE account_id = v_uid
    ORDER BY created_at DESC
    LIMIT 20
  ) x;

  RETURN jsonb_build_object(
    'ok', true,
    'balance', COALESCE(v_balance, 0),
    'lifetime_earned', COALESCE(v_earned, 0),
    'lifetime_redeemed', COALESCE(v_redeemed, 0),
    'referral_kickback_month', COALESCE(v_month_kick, 0),
    'referral_kickback_cap', 15000,
    'next_expiry', v_next_expiry,
    'expiring_within_30d', COALESCE(v_expiring_30d, 0),
    'config', jsonb_build_object(
      'earn_rate', 0.04,
      'referral_rate', 0.01,
      'referral_bonus', 2500,
      'review_bonus', 2500,
      'referral_monthly_cap', 15000,
      'points_expire_months', 12,
      'rewards', jsonb_build_array(
        jsonb_build_object(
          'key', 'free_joint',
          'title', 'Free Plain Joint',
          'points', 5000,
          'product_id', 'plain-joint',
          'blurb', 'Classic plain — on us'
        ),
        jsonb_build_object(
          'key', 'free_flavored_joint',
          'title', 'Free Flavored Joint',
          'points', 7500,
          'product_id', 'scout-pack',
          'blurb', 'Any flavor — pick when you redeem'
        )
      )
    ),
    'history', COALESCE(v_history, '[]'::jsonb)
  );
END;
$function$;
