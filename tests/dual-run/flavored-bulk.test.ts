/**
 * Dual-run: legacy flavored-cookie-pricing vs v2 domain/pricing/flavored-bulk.
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import * as legacy from '../../legacy/js/flavored-cookie-pricing.js';
import * as next from '../../src/domain/pricing/flavored-bulk.ts';

type Line = {
  key?: string;
  productId?: string;
  product_id?: string;
  quantity?: number;
  breakdown?: Record<string, number>;
  lineTotal?: number;
  isReward?: boolean;
};

const arbBreakdown = fc.record({
  cookie_chocolate: fc.nat({ max: 6 }),
  cookie_mint: fc.nat({ max: 6 }),
  cookie_strawberry: fc.nat({ max: 6 }),
  cookie_butterscotch: fc.nat({ max: 4 }),
});

const arbLine: fc.Arbitrary<Line> = fc.oneof(
  fc.record({
    key: fc.string({ minLength: 1, maxLength: 8 }),
    productId: fc.constant('cookie_single'),
    breakdown: arbBreakdown,
    quantity: fc.constant(1),
  }),
  fc.record({
    key: fc.string({ minLength: 1, maxLength: 8 }),
    productId: fc.constantFrom('cookie_duet', 'cookie_trio', 'cookie_quartet'),
    breakdown: arbBreakdown,
    quantity: fc.integer({ min: 1, max: 3 }),
  }),
  fc.record({
    key: fc.string({ minLength: 1, maxLength: 8 }),
    productId: fc.constant('scout'),
    quantity: fc.constant(1),
    breakdown: fc.constant({ mint: 1 }),
  }),
);

describe('flavored-bulk dual-run', () => {
  it('matches unit/threshold constants', () => {
    expect(next.FLAVORED_COOKIE_BULK_UGX).toBe(legacy.FLAVORED_COOKIE_BULK_UGX);
    expect(next.FLAVORED_COOKIE_UNIT_UGX).toBe(legacy.FLAVORED_COOKIE_UNIT_UGX);
    expect(next.FLAVORED_COOKIE_THRESHOLD).toBe(legacy.FLAVORED_COOKIE_THRESHOLD);
  });

  it('matches hand-picked bulk cases', () => {
    const below = [{ productId: 'cookie_single', breakdown: { cookie_mint: 2 } }];
    const at = [{ productId: 'cookie_single', breakdown: { cookie_mint: 2, cookie_chocolate: 2 } }];
    expect(next.sumFlavoredCookies(below)).toBe(legacy.sumFlavoredCookies(below));
    expect(next.unitPriceUgx(2)).toBe(legacy.unitPriceUgx(2));
    expect(next.unitPriceUgx(4)).toBe(legacy.unitPriceUgx(4));
    expect(next.singleLineTotalUgx(at[0]!.breakdown!, 4)).toBe(
      legacy.singleLineTotalUgx(at[0]!.breakdown!, 4),
    );
    expect(next.packPriceUgx('cookie_duet', 4, { cookie_mint: 1, cookie_chocolate: 1 })).toBe(
      legacy.packPriceUgx('cookie_duet', 4, { cookie_mint: 1, cookie_chocolate: 1 }),
    );
  });

  it('matches sumFlavoredCookies / packPrice / applyToCartLines (2000 runs)', () => {
    fc.assert(
      fc.property(fc.array(arbLine, { maxLength: 6 }), (lines) => {
        const a = structuredClone(lines);
        const b = structuredClone(lines);
        expect(next.sumFlavoredCookies(a)).toBe(legacy.sumFlavoredCookies(b));
        expect(next.getProgress(a)).toEqual(legacy.getProgress(b));

        const a2 = structuredClone(lines);
        const b2 = structuredClone(lines);
        const changedA = next.applyToCartLines(a2);
        const changedB = legacy.applyToCartLines(b2);
        expect(changedA).toBe(changedB);
        expect(a2).toEqual(b2);
      }),
      { numRuns: 2000 },
    );
  }, 20_000);
});
