/**
 * Dual-run: legacy config cookie helpers vs domain/catalog.
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  cookieCategoryId,
  cookieUnitPrice,
  cookieWholesaleUgx,
  canonicalInventoryCategoryId,
  normalizeInventoryBreakdown,
  cookieLineDisplayName,
  COOKIE_FLAVORS,
  PRODUCTS,
  CATEGORIES,
  COOKIE_PARTNER_SETTLE_EVERY,
  COOKIE_OWNER_SHARE,
} from '../../legacy/js/config.js';
import * as next from '../../src/domain/catalog.ts';

describe('catalog dual-run', () => {
  it('matches product and category counts/prices', () => {
    expect(next.PRODUCTS.map((p) => [p.id, p.price, p.unitPrice])).toEqual(
      PRODUCTS.map((p: { id: string; price?: number; unitPrice?: number }) => [
        p.id,
        p.price,
        p.unitPrice,
      ]),
    );
    expect(next.CATEGORIES.map((c) => c.id)).toEqual(CATEGORIES.map((c: { id: string }) => c.id));
    expect(next.COOKIE_FLAVORS).toEqual(COOKIE_FLAVORS);
    expect(next.COOKIE_PARTNER_SETTLE_EVERY).toBe(COOKIE_PARTNER_SETTLE_EVERY);
    expect(next.COOKIE_OWNER_SHARE).toBe(COOKIE_OWNER_SHARE);
  });

  it('matches cookieUnitPrice / wholesale / category ids', () => {
    for (const id of [
      'cookie_butterscotch',
      'cookie_mint',
      'cookie',
      'mint',
      '',
      'cookie_chocolate',
    ]) {
      expect(next.cookieUnitPrice(id)).toBe(cookieUnitPrice(id));
      expect(next.cookieWholesaleUgx(id)).toBe(cookieWholesaleUgx(id));
      expect(next.canonicalInventoryCategoryId(id)).toBe(canonicalInventoryCategoryId(id));
    }
  });

  it('matches cookieCategoryId for random flavor ids', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(next.cookieCategoryId(s)).toBe(cookieCategoryId(s));
      }),
      { numRuns: 500 },
    );
  });

  it('matches normalizeInventoryBreakdown', () => {
    const raw = { cookie: 3, cookie_mint: 2, junk: 0 };
    expect(next.normalizeInventoryBreakdown(raw)).toEqual(normalizeInventoryBreakdown(raw));
  });

  it('matches cookieLineDisplayName', () => {
    expect(next.cookieLineDisplayName('cookie_single', { cookie_mint: 1 })).toBe(
      cookieLineDisplayName('cookie_single', { cookie_mint: 1 }),
    );
    expect(next.cookieLineDisplayName('cookie_duet', {})).toBe(
      cookieLineDisplayName('cookie_duet', {}),
    );
  });
});
