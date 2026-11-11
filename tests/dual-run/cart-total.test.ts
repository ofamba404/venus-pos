/**
 * Dual-run: legacy state.cartTotal vs domain/cart.cartTotal.
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { cartTotal as legacyCartTotal } from '../../legacy/js/state.js';
import { cartTotal } from '../../src/domain/cart.ts';

describe('cartTotal dual-run', () => {
  it('matches hand-picked carts', () => {
    const cart = [
      { lineTotal: 8000 },
      { lineTotal: 15000, isReward: false },
      { lineTotal: 9999, isReward: true },
      { lineTotal: '12000' },
    ];
    expect(cartTotal(cart as never)).toBe(legacyCartTotal(cart));
  });

  it('matches random carts (2000 runs)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            lineTotal: fc.double({ min: -100, max: 1e6, noNaN: true }),
            isReward: fc.boolean(),
          }),
          { maxLength: 12 },
        ),
        (cart) => {
          expect(cartTotal(cart as never)).toBe(legacyCartTotal(cart));
        },
      ),
      { numRuns: 2000 },
    );
  });
});
