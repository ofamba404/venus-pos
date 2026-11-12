/**
 * Legacy snapshot of period bounds and the sales heatmap.
 * `analytics-chart.js` is the source. v2 period UI comes later; this locks v1.
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  CHART_RANGES,
  computeSalesPatterns,
  filterSalesByRange,
  mondayOfWeek,
  rangeBounds,
} from '../../legacy/js/analytics-chart.js';

describe('analytics chart legacy snapshot', () => {
  it('mondayOfWeek is a Monday on or before the input (2000 runs)', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01'), noInvalidDate: true }),
        (d) => {
        const mon = mondayOfWeek(d);
        expect(mon.getDay()).toBe(1);
        expect(mon.getTime()).toBeLessThanOrEqual(d.getTime());
        expect(d.getTime() - mon.getTime()).toBeLessThan(7 * 24 * 60 * 60 * 1000);
      }),
      { numRuns: 2000 },
    );
  });

  it('this-week bounds contain now, and last-week ends before this Monday', () => {
    const now = new Date('2026-11-12T12:00:00+03:00');
    const thisWeek = CHART_RANGES.find((r: { id: string }) => r.id === '1w');
    const lastWeek = CHART_RANGES.find((r: { id: string }) => r.id === 'lw');
    const current = rangeBounds(thisWeek, now);
    const previous = rangeBounds(lastWeek, now);
    expect(current.start.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(current.end.getTime()).toBeGreaterThanOrEqual(now.getTime());
    expect(previous.end.getTime()).toBeLessThan(current.start.getTime());
  });

  it('heatmap cells sum to recognized revenue and count joints', () => {
    const sales = [
      {
        created_at: '2026-11-12T10:00:00.000Z',
        total_ugx: 8000,
        is_credit: false,
        credit_cleared: false,
        amount_paid_ugx: 8000,
        items: [{ breakdown: { mint: 1, cookie_mint: 2 } }],
      },
    ];
    const patterns = computeSalesPatterns(sales);
    const heatSum = (patterns.heat as number[][]).reduce(
      (sum: number, row: number[]) => sum + row.reduce((a: number, b: number) => a + b, 0),
      0,
    );
    expect(heatSum).toBe(patterns.paidRevenue);
    expect(patterns.joints).toBe(1);
    expect(patterns.cookies).toBe(2);
    expect(patterns.peakCell.rev).toBe(patterns.paidRevenue);
  });

  it('all-time filter keeps every sale', () => {
    const sales = [{ created_at: '2020-01-01T00:00:00.000Z', total_ugx: 1 }];
    const all = CHART_RANGES.find((r: { id: string }) => r.id === 'all');
    expect(filterSalesByRange(sales, all)).toHaveLength(1);
  });
});
