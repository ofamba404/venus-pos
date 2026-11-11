/**
 * Dual-run: partner batch chunking (money totals).
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import {
  cookiePartnerBatchesFromUnits,
  expandCookieUnitsFromItem,
} from '../../legacy/js/revenue.js';
import {
  cookiePartnerBatchesFromUnits as nextBatches,
  expandCookieUnitsFromItem as nextExpand,
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
    const ours = nextBatches(units, 25);
    expect(ours).toEqual(legacy);
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
});
