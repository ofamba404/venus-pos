-- Review bonus is paid when the owner APPROVES a review, not when the
-- customer leaves it. Replaces the AFTER INSERT trigger from
-- 20261108110000_store_reviews_reward_bonus.
--
-- Project ref xiangrykfxlnacthjcad (venus-pos-inventory).
--
-- * Fires when store_reviews.status changes to 'approved'.
-- * Same ledger kind ('review_bonus') and idempotency key
--   ('review_bonus:<account_id>'), so it is still once per account for
--   its lifetime. Approving a second review, or re-approving after a
--   hide, pays nothing more.
-- * Hiding or deleting a review does not claw points back.
-- * Backfill from 20261108110000 stands (all existing reviews were
--   already approved).
--
-- Safe to re-run.

drop trigger if exists store_reviews_award_bonus on public.store_reviews;

create or replace function private.store_reviews_award_bonus()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from 'approved' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status is not distinct from 'approved' then
    return null;
  end if;
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
      pg_catalog.jsonb_build_object('review_id', new.id, 'bonus', 2500, 'on', 'approve')
    );
  exception when others then
    raise warning 'review_bonus award failed for review %: %', new.id, sqlerrm;
  end;

  return null;
end;
$$;

revoke all on function private.store_reviews_award_bonus() from public, anon, authenticated;

create trigger store_reviews_award_bonus
  after update of status on public.store_reviews
  for each row
  when (new.status = 'approved' and old.status is distinct from 'approved')
  execute function private.store_reviews_award_bonus();
