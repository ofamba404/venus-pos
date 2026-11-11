/**
 * Dual-run: legacy sold-breakdown composition vs domain/inventory-delta.
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { CATEGORIES, normalizeInventoryBreakdown } from '../../legacy/js/config.js';
import {
  mergeSoldBreakdown,
  soldDeltas,
  cartSoldDeltas,
  applySoldToInventory,
  adjustDraftForItem,
} from '../../src/domain/inventory-delta.ts';

const KNOWN_IDS = new Set(CATEGORIES.map((c: { id: string }) => c.id));

/** Oracle mirroring `persistSoldBreakdown` entry filter (no network). */
function legacySoldDeltas(soldById: Record<string, unknown>) {
  const entries = Object.entries(normalizeInventoryBreakdown(soldById)).filter(
    ([id, qty]) => KNOWN_IDS.has(id) && Number(qty) > 0,
  );
  return Object.fromEntries(entries.map(([id, qty]) => [id, -Number(qty)]));
}

/** Oracle mirroring checkout `mergedBreakdown` loop. */
function legacyMergeSold(lines: Array<{ breakdown?: Record<string, unknown> }>) {
  const merged: Record<string, number> = {};
  lines.forEach((item) => {
    Object.entries(normalizeInventoryBreakdown(item.breakdown)).forEach(([id, qty]) => {
      merged[id] = (merged[id] || 0) + qty;
    });
  });
  return merged;
}

describe('inventory-delta dual-run', () => {
  it('maps legacy cookie → cookie_butterscotch and drops unknowns', () => {
    const sold = { cookie: 2, cookie_mint: 1, junk: 9, mint: 0 };
    expect(soldDeltas(sold)).toEqual(legacySoldDeltas(sold));
    expect(soldDeltas(sold)).toEqual({
      cookie_butterscotch: -2,
      cookie_mint: -1,
    });
  });

  it('merges cart lines including stockDeferred (checkout behaviour)', () => {
    const lines = [
      { breakdown: { mint: 1, strawberry: 1 } },
      { breakdown: { cookie: 3 }, stockDeferred: true },
      { breakdown: { cookie_mint: 2 } },
    ];
    expect(mergeSoldBreakdown(lines)).toEqual(legacyMergeSold(lines));
    expect(cartSoldDeltas(lines)).toEqual(legacySoldDeltas(legacyMergeSold(lines)));
  });

  it('applySoldToInventory clamps at 0 like checkout', () => {
    const inv = { mint: 2, cookie_butterscotch: 5 };
    const sold = { mint: 5, cookie: 2 };
    const next = applySoldToInventory(inv, sold);
    expect(next.mint).toBe(0);
    expect(next.cookie_butterscotch).toBe(3);
  });

  it('adjustDraftForItem skips stockDeferred lines', () => {
    const draft = { mint: 10, cookie_mint: 10 };
    expect(
      adjustDraftForItem(draft, { breakdown: { mint: 2 }, stockDeferred: true }, -1),
    ).toEqual(draft);
    expect(adjustDraftForItem(draft, { breakdown: { mint: 2 } }, -1)).toEqual({
      mint: 8,
      cookie_mint: 10,
    });
  });

  it('soldDeltas matches legacy filter for random maps (2000 runs)', () => {
    const ids = CATEGORIES.map((c: { id: string }) => c.id).concat(['cookie', 'nope', '']);
    fc.assert(
      fc.property(
        fc.dictionary(fc.constantFrom(...ids), fc.integer({ min: -3, max: 12 }), {
          maxKeys: 8,
        }),
        (sold) => {
          expect(soldDeltas(sold)).toEqual(legacySoldDeltas(sold));
        },
      ),
      { numRuns: 2000 },
    );
  });
});
