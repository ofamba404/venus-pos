import { describe, expect, it } from 'vitest';
import { emptyCart, cartReducer, buildCartLine } from '../../src/domain/cart';
import { toHeldSale } from '../../src/domain/cart';
import { findProduct } from '../../src/domain/pricing/pack-config';
import { deleteHeld, listHeld, saveHeld } from '../../src/data/held';

describe('device hold store', () => {
  it('saves and removes a parked counter sale on this device', async () => {
    const cookie = findProduct('cookie_single')!;
    let state = emptyCart();
    state = cartReducer(state, {
      type: 'add_line',
      line: buildCartLine(cookie, { cookie_mint: 1 }, { now: 3 }),
    });
    state = cartReducer(state, { type: 'set_meta', meta: { clientName: 'Walk-in' } });
    const held = toHeldSale(state, { id: 'held-test', now: new Date('2026-11-12T11:00:00Z') });
    expect(held).not.toBeNull();
    await saveHeld(held!);
    const rows = await listHeld();
    expect(rows.some((row) => row.id === 'held-test' && row.name === 'Walk-in')).toBe(true);
    await deleteHeld('held-test');
    const after = await listHeld();
    expect(after.some((row) => row.id === 'held-test')).toBe(false);
  });
});
