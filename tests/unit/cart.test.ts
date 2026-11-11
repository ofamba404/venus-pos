import { describe, expect, it } from 'vitest';
import {
  emptyCart,
  cartReducer,
  cartTotal,
  buildCartLine,
  toHeldSale,
  resumeHeldSale,
  defaultOrderMeta,
} from '../../src/domain/cart';
import { findProduct } from '../../src/domain/pricing/pack-config';

describe('cart reducer', () => {
  it('adds lines and reprices flavoured bulk across the cart', () => {
    const cookie = findProduct('cookie_single')!;
    let state = emptyCart();
    const a = buildCartLine(cookie, { cookie_mint: 2 }, { now: 1 });
    state = cartReducer(state, { type: 'add_line', line: a });
    expect(state.lines).toHaveLength(1);
    expect(state.lines[0].lineTotal).toBe(16000); // 2 × 8000

    const b = buildCartLine(
      cookie,
      { cookie_chocolate: 2 },
      { otherLines: state.lines, now: 2 },
    );
    state = cartReducer(state, { type: 'add_line', line: b });
    // Combined flavoured count 4 → bulk 6500 each
    expect(state.lines.map((l) => l.lineTotal)).toEqual([13000, 13000]);
    expect(cartTotal(state.lines)).toBe(26000);
  });

  it('ignores reward lines in cartTotal', () => {
    expect(
      cartTotal([
        {
          key: '1',
          productId: 'scout',
          name: 'Scout',
          detail: '',
          breakdown: { mint: 1 },
          lineTotal: 8000,
        },
        {
          key: '2',
          productId: 'reward',
          name: 'Free',
          detail: '',
          breakdown: {},
          lineTotal: 8000,
          isReward: true,
        },
      ]),
    ).toBe(8000);
  });

  it('set_meta / clear_lines / remove_line', () => {
    let state = emptyCart();
    state = cartReducer(state, {
      type: 'set_meta',
      meta: { clientName: 'Amina', isCredit: true },
    });
    expect(state.meta.clientName).toBe('Amina');
    expect(state.meta.isCredit).toBe(true);
    expect(state.meta.deliveryEnabled).toBe(true); // default preserved

    const line = {
      key: 'x',
      productId: 'scout',
      name: 'Scout Pack',
      detail: 'Mint x1',
      breakdown: { mint: 1 },
      lineTotal: 8000,
    };
    state = cartReducer(state, { type: 'add_line', line });
    state = cartReducer(state, { type: 'remove_line', key: 'x' });
    expect(state.lines).toEqual([]);
    state = cartReducer(state, { type: 'add_line', line });
    state = cartReducer(state, { type: 'clear_lines' });
    expect(state.lines).toEqual([]);
    expect(state.meta.clientName).toBe('Amina');
  });

  it('hold / resume round-trips; blocks store-order holds', () => {
    const cookie = findProduct('cookie_single')!;
    let state = emptyCart();
    state = cartReducer(state, {
      type: 'add_line',
      line: buildCartLine(cookie, { cookie_mint: 1 }, { now: 9 }),
    });
    state = cartReducer(state, { type: 'set_meta', meta: { clientName: 'Jean' } });

    const held = toHeldSale(state, { now: new Date('2026-11-12T10:42:00+03:00') });
    expect(held?.name).toBe('Jean');
    expect(held?.lines).toHaveLength(1);

    const resumed = resumeHeldSale(held!);
    expect(resumed.meta.clientName).toBe('Jean');
    expect(resumed.lines[0].productId).toBe('cookie_single');

    const storeCart = cartReducer(state, {
      type: 'set_meta',
      meta: { storeOrderId: 'abc' },
    });
    expect(toHeldSale(storeCart)).toBeNull();
  });

  it('defaultOrderMeta matches v1 keys', () => {
    expect(Object.keys(defaultOrderMeta()).sort()).toEqual(
      [
        'clientName',
        'clientId',
        'isCredit',
        'clientPhone',
        'deliveryEnabled',
        'deliveryTimeLabel',
        'deliveryLocationLabel',
        'deliveryTimeMode',
        'deliveryDeliverAt',
        'storeOrderId',
      ].sort(),
    );
  });
});
