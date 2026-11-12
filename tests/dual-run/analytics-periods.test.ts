/**
 * Dual-run: analytics-chart period bucketing and heatmap vs domain/analytics.
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import {
  CHART_RANGES,
  INSIGHT_PERIODS,
  buildTimeSeries,
  computeSalesPatterns,
  filterSalesByInsightPeriod,
  filterSalesByRange,
  mondayOfWeek,
  priorPeriodComparison,
  rangeBounds,
} from '../../legacy/js/analytics-chart.js';
import {
  CHART_RANGES as nextRanges,
  INSIGHT_PERIODS as nextPeriods,
  buildTimeSeries as nextSeries,
  filterSalesByInsightPeriod as nextInsight,
  filterSalesByRange as nextFilter,
  priorPeriodComparison as nextPrior,
  rangeBounds as nextBounds,
} from '../../src/domain/analytics/periods';
import { mondayOfWeek as nextMonday } from '../../src/domain/history-groups';
import { computeSalesPatterns as nextPatterns } from '../../src/domain/analytics/patterns';

type Sale = {
  created_at: string;
  total_ugx: number;
  is_credit: boolean;
  credit_cleared: boolean;
  amount_paid_ugx: number;
  items: Array<{ breakdown: Record<string, number>; line_total?: number; product_id?: string }>;
};

function stamp(d: Date) {
  return d.toISOString();
}

function seriesView(buckets: Array<{ date: Date; label: string; revenue: number; orders: number }>) {
  return buckets.map((b) => ({
    label: b.label,
    revenue: b.revenue,
    orders: b.orders,
    date: stamp(b.date),
  }));
}

function boundsView(bounds: { start: Date; end: Date } | null) {
  if (!bounds) return null;
  return { start: stamp(bounds.start), end: stamp(bounds.end) };
}

const saleArb = fc.record({
  created_at: fc
    .integer({ min: Date.parse('2025-01-01T00:00:00Z'), max: Date.parse('2026-11-12T00:00:00Z') })
    .map((t) => new Date(t).toISOString()),
  total_ugx: fc.integer({ min: 0, max: 80000 }),
  is_credit: fc.boolean(),
  credit_cleared: fc.boolean(),
  amount_paid_ugx: fc.integer({ min: 0, max: 80000 }),
  items: fc.array(
    fc.record({
      product_id: fc.constantFrom('scout', 'cookie_single', 'cookie_duet'),
      line_total: fc.integer({ min: 0, max: 40000 }),
      breakdown: fc.record({
        mint: fc.integer({ min: 0, max: 3 }),
        cookie_mint: fc.integer({ min: 0, max: 3 }),
      }),
    }),
    { maxLength: 2 },
  ),
});

describe('analytics periods dual-run', () => {
  it('copies range and insight-period ids', () => {
    expect(nextRanges.map((r) => r.id)).toEqual(CHART_RANGES.map((r: { id: string }) => r.id));
    expect(nextPeriods.map((r) => r.short)).toEqual(
      INSIGHT_PERIODS.map((r: { short: string }) => r.short),
    );
  });

  it('mondayOfWeek matches legacy (2000 runs)', () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date('2020-01-01T00:00:00Z'),
          max: new Date('2030-01-01T00:00:00Z'),
          noInvalidDate: true,
        }),
        (d) => {
          expect(nextMonday(d).getTime()).toBe(mondayOfWeek(d).getTime());
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('range bounds match for every chart range (2000 clocks)', () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date('2024-01-01T00:00:00Z'),
          max: new Date('2027-12-31T00:00:00Z'),
          noInvalidDate: true,
        }),
        (now) => {
          for (const range of CHART_RANGES) {
            expect(boundsView(nextBounds(range, now))).toEqual(boundsView(rangeBounds(range, now)));
          }
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('filters, series, prior copy, and heatmap match (2000 runs)', () => {
    fc.assert(
      fc.property(fc.array(saleArb, { maxLength: 6 }), (sales: Sale[]) => {
        const week = CHART_RANGES.find((r: { id: string }) => r.id === '1w');
        const month = INSIGHT_PERIODS.find((r: { id: string }) => r.id === 'month');
        expect(nextFilter(sales, week).map((s) => s.created_at)).toEqual(
          filterSalesByRange(sales, week).map((s: Sale) => s.created_at),
        );
        expect(nextInsight(sales, month).length).toBe(filterSalesByInsightPeriod(sales, month).length);
        for (const range of CHART_RANGES) {
          expect(seriesView(nextSeries(sales, range))).toEqual(seriesView(buildTimeSeries(sales, range)));
          expect(nextPrior(sales, range)).toEqual(priorPeriodComparison(sales, range));
        }
        expect(nextPatterns(sales)).toEqual(computeSalesPatterns(sales));
      }),
      { numRuns: 2000 },
    );
  }, 30_000);

  it('uses weekday labels for a month that is still in its first 10 days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-05T12:00:00+03:00'));
    try {
      const month = CHART_RANGES.find((r: { id: string }) => r.id === '1m');
      const sales: Sale[] = [
        {
          created_at: '2026-06-02T10:00:00+03:00',
          total_ugx: 8000,
          is_credit: false,
          credit_cleared: false,
          amount_paid_ugx: 8000,
          items: [{ product_id: 'scout', line_total: 8000, breakdown: { mint: 1 } }],
        },
      ];
      expect(seriesView(nextSeries(sales, month))).toEqual(seriesView(buildTimeSeries(sales, month)));
      expect(nextSeries(sales, month).some((b) => b.label === 'Tue' || b.label === 'Mon')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
