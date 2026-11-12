/**
 * Dual-run: partner batch chunking (money totals).
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  cookieBatchShareText,
  cookiePartnerBatchesFromCuts,
  cookiePartnerBatchesFromUnits,
  cookiePartnerShareText,
  cookieUnitsChronological,
  expandCookieUnitsFromItem,
} from '../../legacy/js/revenue.js';
import {
  cookieBatchShareText as nextShare,
  cookiePartnerBatchesFromCuts as nextCuts,
  cookiePartnerBatchesFromUnits as nextBatches,
  cookiePartnerShareText as nextShares,
  expandCookieUnitsFromItem as nextExpand,
  expandPartnerUnitsFromSales,
} from '../../src/domain/partner.ts';

describe('partner dual-run', () => {
  it('chunks units into batches of every=25 with matching money totals', () => {
    const units = Array.from({ length: 30 }, () => ({
      revenue: 8000,
      ownerSplit: 2000,
      partnerDue: 6000,
      flavorId: 'mint',
      kind: 'single',
      cookieQty: 1,
    }));
    const legacy = cookiePartnerBatchesFromUnits(units, 25).map((b: Record<string, unknown>) => ({
      index: b.index,
      cookieCount: b.cookieCount,
      every: b.every,
      complete: b.complete,
      revenue: b.revenue,
      ownerSplit: b.ownerSplit,
      partnerDue: b.partnerDue,
    }));
    const ours = nextBatches(units, 25).map((b) => ({
      index: b.index,
      cookieCount: b.cookieCount,
      every: b.every,
      complete: b.complete,
      revenue: b.revenue,
      ownerSplit: b.ownerSplit,
      partnerDue: b.partnerDue,
    }));
    expect(ours).toEqual(legacy);
  });

  it('keeps a partial send as its own batch', () => {
    const units = Array.from({ length: 30 }, (_, i) => ({
      revenue: 1000 + i,
      ownerSplit: 100,
      partnerDue: 900,
      flavorId: 'mint',
    }));
    const map = (rows: Array<Record<string, unknown>>) =>
      rows.map((b) => ({
        index: b.index,
        cookieCount: b.cookieCount,
        every: b.every,
        complete: b.complete,
        revenue: b.revenue,
        ownerSplit: b.ownerSplit,
        partnerDue: b.partnerDue,
      }));
    expect(map(nextCuts(units, [25, 5], 25))).toEqual(map(cookiePartnerBatchesFromCuts(units, [25, 5], 25)));
    expect(nextCuts(units, [0, 10], 25)).toHaveLength(1);
    expect(nextCuts([], [10], 25)).toEqual([]);
    expect(nextCuts(units, [3], Number.NaN)[0]?.every).toBe(25);
  });

  it('expandCookieUnitsFromItem matches legacy money totals', () => {
    const item = {
      product_id: 'cookie_duet',
      line_total: 15000,
      breakdown: { cookie_mint: 1, cookie_chocolate: 1 },
    };
    const legacy = expandCookieUnitsFromItem(item, 1).map((u: Record<string, unknown>) => ({
      flavorId: u.flavorId,
      revenue: Math.round(Number(u.revenue)),
      ownerSplit: Math.round(Number(u.ownerSplit)),
      partnerDue: Math.round(Number(u.partnerDue)),
    }));
    const ours = nextExpand(item, 1).map((u) => ({
      flavorId: u.flavorId,
      revenue: Math.round(u.revenue),
      ownerSplit: Math.round(u.ownerSplit),
      partnerDue: Math.round(u.partnerDue),
    }));
    expect(ours).toEqual(legacy);
  });

  it('matches chronological units and the clipboard text', () => {
    const sales = [
      {
        id: 'early',
        created_at: '2026-08-01T10:00:00+03:00',
        items: [
          {
            product_id: 'cookie_single',
            line_total: 8000,
            breakdown: { cookie_mint: 1 },
          },
        ],
      },
      {
        id: 'later',
        created_at: '2026-08-13T10:00:00+03:00',
        is_credit: true,
        credit_cleared: false,
        total_ugx: 15000,
        amount_paid_ugx: 5000,
        items: [
          {
            product_id: 'cookie_duet',
            line_total: 15000,
            breakdown: { cookie_chocolate: 1, cookie_strawberry: 1 },
          },
        ],
      },
    ];
    const legacyUnits = cookieUnitsChronological(sales).map((u: Record<string, unknown>) => ({
      flavorId: u.flavorId,
      productKind: u.productKind,
      saleId: u.saleId,
      lineKey: u.lineKey,
      lineCookieQty: u.lineCookieQty,
      revenue: u.revenue,
    }));
    const ours = expandPartnerUnitsFromSales(sales).map((u) => ({
      flavorId: u.flavorId,
      productKind: u.productKind,
      saleId: u.saleId,
      lineKey: u.lineKey,
      lineCookieQty: u.lineCookieQty,
      revenue: u.revenue,
    }));
    expect(ours).toEqual(legacyUnits);
    const legacyBatches = cookiePartnerBatchesFromUnits(cookieUnitsChronological(sales), 25);
    const next = nextBatches(expandPartnerUnitsFromSales(sales), 25);
    expect(nextShare(next[0] || null)).toBe(cookieBatchShareText(legacyBatches[0]));
    expect(nextShares(next)).toBe(cookiePartnerShareText(legacyBatches));
    expect(nextShare(null)).toBe('');
    expect(nextShares([])).toBe('');
  });

  it('chunks 2000 generated unit lists the same way', () => {
    const money = fc.integer({ min: 0, max: 100_000 });
    fc.assert(
      fc.property(
        fc.array(fc.record({ revenue: money, ownerSplit: money, partnerDue: money }), { maxLength: 40 }),
        fc.integer({ min: 1, max: 30 }),
        (units, every) => {
          const pick = (b: Record<string, unknown>) => ({
            index: b.index,
            cookieCount: b.cookieCount,
            every: b.every,
            complete: b.complete,
            revenue: b.revenue,
            ownerSplit: b.ownerSplit,
            partnerDue: b.partnerDue,
          });
          const legacy = cookiePartnerBatchesFromUnits(units, every).map(pick);
          expect(nextBatches(units, every).map(pick)).toEqual(legacy);
          expect(nextShare(nextBatches(units, every)[0] || null)).toBe(
            cookieBatchShareText(cookiePartnerBatchesFromUnits(units, every)[0] || null),
          );
          expect(nextShares(nextBatches(units, every))).toBe(
            cookiePartnerShareText(cookiePartnerBatchesFromUnits(units, every)),
          );
        },
      ),
      { numRuns: 2000 },
    );
  });
});
