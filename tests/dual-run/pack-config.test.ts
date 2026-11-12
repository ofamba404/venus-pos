/**
 * Dual-run: legacy product-config pure helpers vs domain/pricing/pack-config.
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  findProduct,
  varietyFixedFlavor,
  varietyFlavorPool,
  productDetailLabel,
  wholesaleUnitPriceFromItem,
  wholesaleUnitPriceFromSelection,
  breakdownToConfigSelection,
  configTotalSelected,
  itemToConfigSelection,
  buildLineFromConfig,
} from '../../legacy/js/product-config.js';
import { PRODUCTS } from '../../legacy/js/config.js';
import * as next from '../../src/domain/pricing/pack-config.ts';

describe('pack-config dual-run', () => {
  it('matches findProduct / variety helpers / detail labels', () => {
    for (const p of PRODUCTS) {
      expect(next.findProduct(p.id)?.id).toBe(findProduct(p.id)?.id);
      expect(next.varietyFixedFlavor(next.findProduct(p.id)!)).toBe(varietyFixedFlavor(p));
      expect(next.varietyFlavorPool(next.findProduct(p.id)!)).toEqual(varietyFlavorPool(p));
      expect(next.productDetailLabel(next.findProduct(p.id)!)).toBe(productDetailLabel(p));
    }
    expect(next.findProduct('nope')).toBeUndefined();
  });

  it('matches breakdownToConfigSelection / itemToConfigSelection', () => {
    const quartet = findProduct('cookie_quartet');
    const plain = findProduct('plain_single');
    const bd = { cookie_mint: 2, cookie_butterscotch: 1, cookie_chocolate: 1 };
    expect(next.breakdownToConfigSelection(next.findProduct('cookie_quartet')!, bd)).toEqual(
      breakdownToConfigSelection(quartet, bd),
    );
    expect(
      next.breakdownToConfigSelection(next.findProduct('plain_single')!, { classic: 3 }),
    ).toEqual(breakdownToConfigSelection(plain, { classic: 3 }));

    const wholesaleItem = {
      breakdown: { cookie_mint: 10 },
      lineTotal: 30000,
      wholesaleUnitPrice: 3000,
    };
    expect(
      next.itemToConfigSelection(next.findProduct('cookie_wholesale')!, wholesaleItem),
    ).toEqual(itemToConfigSelection(findProduct('cookie_wholesale'), wholesaleItem));
  });

  it('matches wholesale unit price helpers', () => {
    expect(
      next.wholesaleUnitPriceFromItem({ breakdown: { cookie_mint: 4 }, lineTotal: 12000 }),
    ).toBe(wholesaleUnitPriceFromItem({ breakdown: { cookie_mint: 4 }, lineTotal: 12000 }));
    expect(next.wholesaleUnitPriceFromSelection({ _unitPrice: 2750.4, cookie_mint: 2 })).toBe(
      wholesaleUnitPriceFromSelection({ _unitPrice: 2750.4, cookie_mint: 2 }),
    );
  });

  it('matches configTotalSelected (ignores _keys)', () => {
    const sel = { mint: 2, strawberry: 1, _unitPrice: 999 };
    expect(next.configTotalSelected(sel)).toBe(configTotalSelected(sel));
  });

  it('matches buildLineFromConfig for every product rule (hand-picked)', () => {
    const cases: Array<{ id: string; sel: Record<string, number>; other?: unknown[] }> = [
      { id: 'scout', sel: { mint: 1 } },
      { id: 'pilot', sel: { mint: 1, strawberry: 1 } },
      { id: 'variety', sel: { mint: 3, blueberry: 4 } },
      { id: 'cookie_duet', sel: { cookie_mint: 1, cookie_chocolate: 1 } },
      { id: 'cookie_trio', sel: { cookie_mint: 1, cookie_chocolate: 1, cookie_strawberry: 1 } },
      { id: 'cookie_quartet', sel: { cookie_mint: 1, cookie_chocolate: 1, cookie_strawberry: 1 } },
      { id: 'plain_single', sel: { qty: 3 } },
      { id: 'spliff_single', sel: { spliff5050: 2, spliff7030: 1 } },
      { id: 'cookie_single', sel: { cookie_mint: 2, cookie_butterscotch: 1 } },
      {
        id: 'cookie_single',
        sel: { cookie_mint: 3 },
        other: [{ productId: 'cookie_single', breakdown: { cookie_chocolate: 2 }, quantity: 1 }],
      },
      { id: 'cookie_wholesale', sel: { cookie_mint: 8, _unitPrice: 3000 } },
    ];

    for (const c of cases) {
      const legacyP = findProduct(c.id);
      const nextP = next.findProduct(c.id)!;
      expect(next.buildLineFromConfig(nextP, c.sel, { otherLines: c.other })).toEqual(
        buildLineFromConfig(legacyP, c.sel, { otherLines: c.other }),
      );
    }
  });

  it('matches buildLineFromConfig for random plain/spliff qty (2000 runs)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 }), fc.integer({ min: 0, max: 20 }), (a, b) => {
        const sel = { spliff5050: a, spliff7030: b };
        const legacyP = findProduct('spliff_single');
        const nextP = next.findProduct('spliff_single')!;
        expect(next.buildLineFromConfig(nextP, sel)).toEqual(buildLineFromConfig(legacyP, sel));
      }),
      { numRuns: 2000 },
    );
  });
});
