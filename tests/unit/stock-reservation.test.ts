/**
 * Store-order stock hold: place claims, a second order is capped, charge does not
 * deduct again, cancel puts the units back.
 */
import { describe, expect, it } from 'vitest';
import { mergeSoldBreakdown } from '../../src/domain/inventory-delta';
import { mapStoreOrderToCart } from '../../src/domain/store-order-map';
import {
  availableFromPools,
  claimAgainstStock,
  counterSellable,
  decideClaim,
  decideConsume,
  decideRevert,
  decideUnclaim,
  releaseAgainstStock,
  reservationOf,
  shortageMessage,
  soldExcludingHold,
  unitsFromOrderItems,
} from '../../src/domain/stock-reservation';

const JOINT_POOL = ['mint', 'strawberry', 'blueberry', 'watermelon', 'grape', 'coconut', 'melon'];

describe('store order stock reservation', () => {
  it('places a hold, blocks the same last units, charge skips them, cancel releases', () => {
    let stock: Record<string, number> = { classic: 5, cookie_mint: 4 };
    const orderA = {
      items: [{ breakdown: { classic: 5 } }, { breakdown: { cookie_mint: 1 } }],
    };
    const unitsA = unitsFromOrderItems(orderA.items);
    const claimed = claimAgainstStock(stock, unitsA);
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    stock = claimed.stock;
    expect(stock).toEqual({ classic: 0, cookie_mint: 3 });

    const tooMany = claimAgainstStock(stock, { classic: 1 });
    expect(tooMany.ok).toBe(false);
    if (tooMany.ok) return;
    expect(tooMany.shortage.classic).toEqual({ have: 0, need: 1 });
    expect(shortageMessage(tooMany.shortage)).toMatch(/Plain/);
    expect(stock.classic).toBe(0);

    const capped = claimAgainstStock(stock, { cookie_mint: 3 });
    expect(capped.ok).toBe(true);
    const overCap = claimAgainstStock(stock, { cookie_mint: 4 });
    expect(overCap.ok).toBe(false);

    const charged = soldExcludingHold(
      mergeSoldBreakdown([
        { breakdown: { classic: 5 }, stockDeferred: true, stockClaimed: true },
        { breakdown: { mint: 1 } },
      ]),
      unitsA,
    );
    expect(charged).toEqual({ mint: 1 });

    stock = releaseAgainstStock(stock, unitsA);
    expect(stock.classic).toBe(5);
    expect(stock.cookie_mint).toBe(4);
    const again = claimAgainstStock(stock, { classic: 5 });
    expect(again.ok).toBe(true);
  });

  it('keeps deducting legacy deferred lines that were never held', () => {
    expect(
      mergeSoldBreakdown([{ breakdown: { classic: 2 }, stockDeferred: true }]),
    ).toEqual({ classic: 2 });
  });

  it('marks held store lines claimed and leaves plain counter stock alone', () => {
    const mapped = mapStoreOrderToCart({
      id: 'ord-hold',
      delivery: { stock_reservation: { state: 'held' } },
      items: [{ product_id: 'plain_single', breakdown: { classic: 5 }, line_total: 25000 }],
    });
    expect(mapped.lines[0]?.stockClaimed).toBe(true);
    expect(mapped.lines[0]?.stockDeferred).toBe(true);

    const sellable = counterSellable(
      { classic: 3 },
      [...mapped.lines, { breakdown: { classic: 1 } }],
    );
    expect(sellable.classic).toBe(2);
  });

  it('counts joint packs the way the storefront gate does', () => {
    const stock: Record<string, number> = {
      mint: 2,
      strawberry: 0,
      blueberry: 0,
      watermelon: 0,
      grape: 0,
      coconut: 0,
      melon: 0,
      classic: 0,
    };
    const left = (id: string) => (Object.prototype.hasOwnProperty.call(stock, id) ? stock[id] ?? 0 : null);
    expect(availableFromPools(left, { slots: 1, fixed: null, pool: JOINT_POOL })).toBe(2);
    expect(availableFromPools(left, { slots: 5, fixed: null, pool: JOINT_POOL })).toBe(0);
    expect(
      availableFromPools(left, { slots: 7, fixed: 'classic', pool: JOINT_POOL }),
    ).toBe(0);
    stock.classic = 3;
    stock.mint = 7;
    expect(
      availableFromPools(left, { slots: 7, fixed: 'classic', pool: JOINT_POOL }),
    ).toBe(1);
  });

  it('lets one phone claim a hold and refuses the second', () => {
    const held = reservationOf({
      delivery: { stock_reservation: { state: 'held', claimed: { classic: 2 } } },
    });
    const first = decideClaim(held, 'phone-a');
    expect(first.ok).toBe(true);
    if (!first.ok || !first.next) throw new Error('expected a claim');
    expect(first.next.claim_device).toBe('phone-a');
    expect(first.next.state).toBe('held');

    const second = decideClaim(first.next, 'phone-b');
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBe('claimed');

    const back = decideUnclaim(first.next, 'phone-a');
    expect(back.ok).toBe(true);
    if (!back.ok || !back.next) throw new Error('expected an unclaim');
    expect(back.next.claim_device).toBeUndefined();
    expect(decideClaim(back.next, 'phone-b').ok).toBe(true);
  });

  it('does not deduct a consumed hold again, and a failed charge leaves stock held', () => {
    const held = reservationOf({
      delivery: {
        stock_reservation: { state: 'held', claimed: { classic: 5 }, claim_device: 'phone-a' },
      },
    });
    const consumed = decideConsume(held, 'phone-a');
    expect(consumed.ok).toBe(true);
    if (!consumed.ok || !consumed.next) throw new Error('expected consume');
    expect(consumed.next.state).toBe('consumed');
    const again = decideConsume(consumed.next, 'phone-a');
    expect(again.ok && again.reason).toBe('already_consumed');
    const other = decideConsume(consumed.next, 'phone-b');
    expect(other.ok).toBe(false);

    const reverted = decideRevert(consumed.next, 'phone-a');
    expect(reverted.ok).toBe(true);
    if (!reverted.ok || !reverted.next) throw new Error('expected revert');
    expect(reverted.next.state).toBe('held');
    expect(reverted.next.claimed).toEqual({ classic: 5 });

    const released = decideConsume(
      { state: 'released', claimed: { classic: 5 } },
      'phone-a',
    );
    expect(released.ok).toBe(false);
  });

  it('drops unknown breakdown keys and ignores non-positive qty', () => {
    expect(unitsFromOrderItems([{ breakdown: { nope: 4, classic: 0, mint: 2 } }])).toEqual({
      mint: 2,
    });
  });
});
