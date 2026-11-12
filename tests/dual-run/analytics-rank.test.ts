/**
 * Dual-run: analytics.js top product + revenue delta vs domain/analytics/rank.
 * Oracles are inlined from legacy/js/analytics.js (the module is not a pure import).
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { canonicalProductName, revenueDelta, topProductForSales } from '../../src/domain/analytics/rank';

function legacyCanonical(name: unknown) {
  const n = String(name || '').trim();
  if (!n) return 'Unknown';
  if (/^plain(\s+joint)?$/i.test(n)) return 'Plain';
  return n;
}

function legacyTop(sales: Array<{ items?: Array<{ product_name?: string }> | null }>) {
  const productTotals: Record<string, number> = {};
  sales.forEach((s) =>
    (s.items || []).forEach((i) => {
      const name = legacyCanonical(i.product_name);
      productTotals[name] = (productTotals[name] || 0) + 1;
    }),
  );
  let topProduct = '—';
  let topCount = 0;
  Object.entries(productTotals).forEach(([name, count]) => {
    if (count > topCount) {
      topCount = count;
      topProduct = name;
    }
  });
  return { topProduct, topCount };
}

function legacyDelta(today: number, yesterday: number) {
  if (yesterday === 0 && today === 0) return { text: 'Same as yesterday', cls: 'neutral' };
  if (yesterday === 0) return { text: 'First sales today', cls: 'up' };
  const pct = Math.round(((today - yesterday) / yesterday) * 100);
  if (pct === 0) return { text: 'Same as yesterday', cls: 'neutral' };
  if (pct > 0) return { text: `+${pct}% vs yesterday`, cls: 'up' };
  return { text: `${pct}% vs yesterday`, cls: 'down' };
}

describe('analytics rank dual-run', () => {
  it('top product matches the legacy counter (2000 runs)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            items: fc.array(fc.record({ product_name: fc.string() }), { maxLength: 6 }),
          }),
          { maxLength: 8 },
        ),
        (sales) => {
          expect(topProductForSales(sales)).toEqual(legacyTop(sales));
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('revenue delta matches the legacy copy (2000 runs)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5_000_000 }), fc.integer({ min: 0, max: 5_000_000 }), (today, yesterday) => {
        expect(revenueDelta(today, yesterday)).toEqual(legacyDelta(today, yesterday));
      }),
      { numRuns: 2000 },
    );
  });

  it('plain aliases collapse', () => {
    expect(canonicalProductName('plain joint')).toBe('Plain');
    expect(canonicalProductName('')).toBe('Unknown');
  });
});
