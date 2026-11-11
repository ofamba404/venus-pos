/**
 * Dual-run: partner batch chunking (money totals).
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { cookiePartnerBatchesFromUnits } from '../../legacy/js/revenue.js';
import { cookiePartnerBatchesFromUnits as nextBatches } from '../../src/domain/partner.ts';

describe('partner dual-run', () => {
  it('chunks units into batches of every=25 with matching money totals', () => {
    const units = Array.from({ length: 30 }, (_, i) => ({
      revenue: 8000,
      ownerSplit: 2000,
      partnerDue: 6000,
      // legacy also builds lines; we only compare money/count fields
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
});
