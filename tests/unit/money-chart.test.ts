import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { moneyChart, moneyUnitFor, profitMarginPct, saleSalesUgx } from '../../src/domain/money-chart';
import { helperConfig } from '../../src/domain/economics';
import { profitPicture, type DecisionSale } from '../../src/domain/decisions';
import { CHART_RANGES } from '../../src/domain/analytics/periods';

// These cases are about the helper's share, so a helper has started. With no start day there is no helper at all
// (tests/unit/helper-since.test.ts).
beforeEach(() => {
  helperConfig.since = '2000-01-01';
});
afterEach(() => {
  helperConfig.since = null;
});

// Thu 12 Nov 2026, midday local.
const NOW = new Date(2026, 10, 12, 12, 0, 0);
const at = (day: number, hour = 10) => new Date(2026, 10, day, hour, 0, 0).toISOString();
const range = (id: string) => CHART_RANGES.find((r) => r.id === id)!;

function pack(id: string, day: number, total: number, extra: Partial<DecisionSale> = {}): DecisionSale {
  const breakdown = id === 'scout' ? { mint: 1 } : { mint: 1, grape: 1 };
  return {
    id: `${id}-${day}`,
    created_at: at(day),
    total_ugx: total,
    is_credit: false,
    items: [{ product_id: id, product_name: id, line_total: total, breakdown }],
    ...extra,
  };
}

const cookie = (day: number): DecisionSale => ({
  id: `cookie-${day}`,
  created_at: at(day),
  total_ugx: 8000,
  is_credit: false,
  items: [{ product_id: 'cookie_single', product_name: 'Cookies', line_total: 8000, breakdown: { cookie_mint: 1 } }],
});

describe('money chart', () => {
  const book = [pack('scout', 9, 8000), pack('pilot', 10, 15000), pack('pilot', 10, 15000), cookie(11), pack('scout', 12, 8000)];

  it('1W: one bucket per day from Monday to today, and the buckets add up to the period', () => {
    const chart = moneyChart(book, range('1w'), null, NOW);
    expect(chart.unit).toBe('day');
    expect(chart.buckets.map((b) => b.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu']);
    const sum = (k: 'sales' | 'owner' | 'helper' | 'partner' | 'profit') => chart.buckets.reduce((a, b) => a + b[k], 0);
    expect(chart.totals.sales).toBe(8000 + 30000 + 8000 + 8000);
    expect(sum('sales')).toBe(chart.totals.sales);
    // Rounding is per bucket, so allow a shilling or two across the period.
    for (const k of ['owner', 'helper', 'partner', 'profit'] as const) {
      expect(Math.abs(sum(k) - chart.totals[k])).toBeLessThanOrEqual(chart.buckets.length);
    }
    expect(chart.max).toBe(Math.max(...chart.buckets.map((b) => b.sales)));
    expect(chart.maxSales).toBe(chart.max);
    expect(chart.maxProfit).toBe(Math.max(1, ...chart.buckets.map((b) => b.profit)));
  });

  it('splits a bucket into owner, helper 40%, partner and costs that add back to sales', () => {
    const chart = moneyChart(book, range('1w'), null, NOW);
    for (const b of chart.buckets) {
      if (b.sales === 0) continue;
      expect(b.owner + b.helper + b.partner + b.costs).toBeGreaterThanOrEqual(b.sales - 1);
      expect(b.owner + b.helper + b.partner + b.costs).toBeLessThanOrEqual(b.sales + 1);
      expect(b.profit).toBe(b.owner + b.helper);
    }
    const picture = profitPicture(book.filter((s) => new Date(s.created_at!) >= new Date(2026, 10, 9)), null);
    expect(chart.totals.owner).toBe(picture.owner);
    expect(chart.totals.helper).toBe(picture.helper);
    expect(chart.totals.partner).toBe(picture.partner);
    expect(Math.round((chart.totals.helper / chart.totals.profit) * 100)).toBe(40);
    // The cookie sale's partner cut shows up as the partner share, not as profit.
    expect(chart.buckets[2]!.partner).toBeGreaterThan(0);
  });

  it('last week and 2 weeks are day buckets too, and an empty week still shows its days', () => {
    expect(moneyChart(book, range('lw'), null, NOW).buckets).toHaveLength(7);
    expect(moneyChart(book, range('lw'), null, NOW).totals.sales).toBe(0);
    expect(moneyChart(book, range('2w'), null, NOW).buckets).toHaveLength(14);
  });

  it('1M is daily, 3M is weekly, All picks the unit from how long the book is', () => {
    const month = moneyChart(book, range('1m'), null, NOW);
    expect(month.unit).toBe('day');
    expect(month.buckets).toHaveLength(12);
    const quarter = moneyChart(book, range('3m'), null, NOW);
    expect(quarter.unit).toBe('week');
    expect(quarter.buckets.length).toBeGreaterThanOrEqual(10);
    expect(quarter.buckets.at(-1)!.title).toMatch(/^Week of/);
    const old = { ...pack('scout', 1, 8000), created_at: new Date(2026, 1, 1, 10).toISOString() };
    const all = moneyChart([old, ...book], range('all'), null, NOW);
    expect(all.unit).toBe('month');
    expect(all.buckets[0]!.label).toBe('Feb');
    expect(all.totals.sales).toBe(8000 + 8000 + 30000 + 8000 + 8000);
    expect(moneyUnitFor(30)).toBe('day');
    expect(moneyUnitFor(100)).toBe('week');
    expect(moneyUnitFor(300)).toBe('month');
  });

  it('counts a credit sale for what has been paid, and ignores rewards', () => {
    const credit = pack('pilot', 12, 15000, { is_credit: true, credit_cleared: false, amount_paid_ugx: 5000 });
    expect(Math.round(saleSalesUgx(credit))).toBe(5000);
    const unpaid = pack('pilot', 12, 15000, { is_credit: true, credit_cleared: false, amount_paid_ugx: 0 });
    expect(saleSalesUgx(unpaid)).toBe(0);
    const reward: DecisionSale = { ...pack('scout', 12, 8000), items: [{ product_id: 'scout', line_total: 8000, is_reward: true, breakdown: { mint: 1 } }] };
    expect(saleSalesUgx(reward)).toBe(0);
  });

  it('handles an empty book and the margin figure', () => {
    expect(moneyChart(null, range('all'), null, NOW).buckets).toEqual([]);
    expect(moneyChart([], range('1w'), null, NOW).totals.sales).toBe(0);
    expect(profitMarginPct({ sales: 0, profit: 0 })).toBe(0);
    expect(profitMarginPct({ sales: 8000, profit: 2000 })).toBe(25);
    expect(moneyChart([{ id: 'x', created_at: 'nope', items: [] }], range('1w'), null, NOW).totals.sales).toBe(0);
  });
});
