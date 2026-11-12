/**
 * Dual-run: legacy inventory stock helpers vs domain/stock-state.
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { cookieStockLevel } from '../../legacy/js/inventory.js';
import { LOW_STOCK_THRESHOLD } from '../../src/domain/catalog.ts';
import { stockLevel, stockCrossing } from '../../src/domain/stock-state.ts';

/** v1 no longer exports stockState. The body is still the joint rule. */
function stockState(qty: number) {
  if (qty <= 0) return 'out';
  if (qty < LOW_STOCK_THRESHOLD) return 'low';
  return 'ok';
}

describe('stock-state dual-run', () => {
  it('matches joint stockState for hand-picked qty', () => {
    expect(readFileSync('legacy/js/inventory.js', 'utf8')).toContain('function stockState(qty)');
    for (const qty of [0, 1, 4, 5, 6, 30, -1]) {
      expect(stockLevel('mint', qty)).toBe(stockState(qty));
    }
  });

  it('matches cookieStockLevel.state for hand-picked qty', () => {
    for (const qty of [0, 1, 5, 29, 30, 50, 100]) {
      expect(stockLevel('cookie_mint', qty)).toBe(cookieStockLevel(qty).state);
    }
  });

  it('matches stockState for random joint qty (2000 runs)', () => {
    fc.assert(
      fc.property(fc.integer({ min: -5, max: 200 }), (qty) => {
        expect(stockLevel('strawberry', qty)).toBe(stockState(qty));
      }),
      { numRuns: 2000 },
    );
  });

  it('matches cookieStockLevel.state for random cookie qty (2000 runs)', () => {
    fc.assert(
      fc.property(fc.integer({ min: -5, max: 200 }), (qty) => {
        expect(stockLevel('cookie_butterscotch', qty)).toBe(cookieStockLevel(qty).state);
      }),
      { numRuns: 2000 },
    );
  });

  it('crossing detects low/out/recover transitions', () => {
    expect(stockCrossing('mint', 10, 4)).toEqual({
      crossedLow: true,
      crossedOut: false,
      recovered: false,
    });
    expect(stockCrossing('mint', 2, 0)).toEqual({
      crossedLow: false,
      crossedOut: true,
      recovered: false,
    });
    expect(stockCrossing('mint', 0, 10)).toEqual({
      crossedLow: false,
      crossedOut: false,
      recovered: true,
    });
  });
});
