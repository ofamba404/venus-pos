/**
 * Period bounds, bucketing, and prior-period copy.
 * Port of the pure half of `legacy/js/analytics-chart.js`.
 */
import { mondayOfWeek } from '../history-groups';
import { saleRecognizedOwnerRevenue, sumOwnerRevenue, type SaleLike } from '../revenue';

export type ChartRange = {
  id: string;
  label: string;
  short: string;
  unit: 'week' | 'month' | null;
  count: number | null;
  offset?: number;
};

export type DatedSale = SaleLike & { created_at?: string };

export type TimeBucket = {
  date: Date;
  label: string;
  revenue: number;
  orders: number;
};

export const CHART_RANGES: ChartRange[] = [
  { id: '1w', label: 'This week', short: '1W', unit: 'week', count: 1 },
  { id: 'lw', label: 'Last week', short: 'LW', unit: 'week', count: 1, offset: 1 },
  { id: '2w', label: 'Last 2 weeks', short: '2W', unit: 'week', count: 2, offset: 2 },
  { id: '1m', label: 'This month', short: '1M', unit: 'month', count: 1 },
  { id: '3m', label: 'Last 3 months', short: '3M', unit: 'month', count: 3 },
  { id: 'all', label: 'All time', short: 'All', unit: null, count: null },
];

export const INSIGHT_PERIODS: ChartRange[] = [
  { id: 'week', label: 'Week', short: 'Week', unit: 'week', count: 1 },
  { id: 'month', label: 'Month', short: 'Month', unit: 'month', count: 1 },
  { id: 'all', label: 'All time', short: 'All', unit: null, count: null },
];

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Inclusive start/end for a chart range (calendar weeks / months). */
export function rangeBounds(range: ChartRange | null | undefined, now = new Date()) {
  if (!range?.unit) return null;
  const count = range.count || 0;
  if (range.unit === 'week') {
    const thisMon = mondayOfWeek(now);
    const offset = range.offset || 0;
    if (offset > 0) {
      const start = new Date(thisMon);
      start.setDate(start.getDate() - offset * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + count * 7 - 1);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    const start = new Date(thisMon);
    start.setDate(start.getDate() - (count - 1) * 7);
    return { start, end: endOfDay(now) };
  }
  if (range.unit === 'month') {
    const start = startOfDay(new Date(now.getFullYear(), now.getMonth() - (count - 1), 1));
    return { start, end: endOfDay(now) };
  }
  return null;
}

export function filterSalesByRange<T extends { created_at?: string }>(
  sales: T[],
  range: ChartRange,
  now = new Date(),
): T[] {
  const bounds = rangeBounds(range, now);
  if (!bounds) return sales;
  return sales.filter((s) => {
    const d = new Date(s.created_at || 0);
    return d >= bounds.start && d <= bounds.end;
  });
}

export function filterSalesByInsightPeriod<T extends { created_at?: string }>(
  sales: T[],
  period: ChartRange,
  now = new Date(),
): T[] {
  return filterSalesByRange(sales, period, now);
}

function bucketLabel(date: Date, mode: string) {
  if (mode === 'weekday') {
    return date.toLocaleDateString(undefined, { weekday: 'short' });
  }
  if (mode === 'short') {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  if (mode === 'tiny') {
    return String(date.getDate());
  }
  if (mode === 'month') {
    return date.toLocaleDateString(undefined, { month: 'short' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function isSameDay(d1: Date, d2: Date) {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function salesForDay(sales: DatedSale[], day: Date) {
  return sales.filter((s) => isSameDay(new Date(s.created_at || 0), day));
}

function daysBetweenInclusive(start: Date, end: Date) {
  const a = startOfDay(start);
  const b = startOfDay(end);
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

function buildDailyBuckets(sales: DatedSale[], start: Date, count: number, labelMode: string) {
  const buckets: TimeBucket[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const daySales = salesForDay(sales, d);
    buckets.push({
      date: d,
      label: bucketLabel(d, labelMode),
      revenue: sumOwnerRevenue(daySales),
      orders: daySales.length,
    });
  }
  return buckets;
}

function buildWeeklyBuckets(sales: DatedSale[], start: Date, end: Date) {
  const buckets: TimeBucket[] = [];
  let cursor = mondayOfWeek(start);
  const endDay = startOfDay(end);
  while (cursor <= endDay) {
    const weekEnd = new Date(cursor);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    const weekSales = sales.filter((s) => {
      const d = new Date(s.created_at || 0);
      return d >= cursor && d <= weekEnd && d <= end;
    });
    buckets.push({
      date: new Date(cursor),
      label: bucketLabel(cursor, 'short'),
      revenue: sumOwnerRevenue(weekSales),
      orders: weekSales.length,
    });
    cursor = new Date(cursor);
    cursor.setDate(cursor.getDate() + 7);
  }
  return buckets;
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}`;
}

export function buildTimeSeries(sales: DatedSale[], range: ChartRange, now = new Date()): TimeBucket[] {
  const bounds = rangeBounds(range, now);

  if (bounds) {
    const { start, end } = bounds;
    const count = daysBetweenInclusive(start, end);

    if (range.unit === 'week') {
      const labelMode = range.count === 1 ? 'weekday' : 'short';
      return buildDailyBuckets(sales, start, count, labelMode);
    }

    if (range.unit === 'month' && range.count === 1) {
      return buildDailyBuckets(sales, start, count, count <= 10 ? 'weekday' : 'tiny');
    }

    if (range.unit === 'month') {
      return buildWeeklyBuckets(sales, start, end);
    }
  }

  if (!sales.length) return [];

  const dates = sales.map((s) => new Date(s.created_at || 0));
  const minDate = startOfDay(new Date(Math.min(...dates.map((d) => d.getTime()))));
  const maxDate = startOfDay(now);
  const spanDays = daysBetweenInclusive(minDate, maxDate);

  if (spanDays <= 45) {
    return buildDailyBuckets(sales, minDate, spanDays, 'short');
  }

  if (spanDays <= 200) {
    return buildWeeklyBuckets(sales, minDate, maxDate);
  }

  const monthMap = new Map<string, { date: Date; revenue: number; orders: number }>();
  sales.forEach((s) => {
    const d = new Date(s.created_at || 0);
    const key = monthKey(d);
    if (!monthMap.has(key)) {
      monthMap.set(key, {
        date: startOfDay(new Date(d.getFullYear(), d.getMonth(), 1)),
        revenue: 0,
        orders: 0,
      });
    }
    const b = monthMap.get(key)!;
    b.revenue += saleRecognizedOwnerRevenue(s);
    b.orders += 1;
  });
  return Array.from(monthMap.values())
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((b) => ({
      ...b,
      label: b.date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
    }));
}

export function priorBounds(range: ChartRange, now = new Date()) {
  if (!range.unit) return null;

  if (range.unit === 'week') {
    const current = rangeBounds(range, now);
    if (!current) return null;
    const priorEnd = new Date(current.start);
    priorEnd.setDate(priorEnd.getDate() - 1);
    priorEnd.setHours(23, 59, 59, 999);
    const priorStart = mondayOfWeek(priorEnd);
    priorStart.setDate(priorStart.getDate() - ((range.count || 1) - 1) * 7);
    return { start: priorStart, end: priorEnd };
  }

  if (range.unit === 'month') {
    const count = range.count || 1;
    const curStart = startOfDay(new Date(now.getFullYear(), now.getMonth() - (count - 1), 1));
    const priorEnd = endOfDay(new Date(curStart.getFullYear(), curStart.getMonth(), 0));
    const priorStart = startOfDay(
      new Date(priorEnd.getFullYear(), priorEnd.getMonth() - (count - 1), 1),
    );
    return { start: priorStart, end: priorEnd };
  }

  return null;
}

export function priorPeriodComparison(sales: DatedSale[], range: ChartRange, now = new Date()) {
  const currentBounds = rangeBounds(range, now);
  if (!currentBounds) return null;

  const current = filterSalesByRange(sales, range, now);
  const currentTotal = sumOwnerRevenue(current);

  const prior = priorBounds(range, now);
  if (!prior) return null;

  const priorSales = sales.filter((s) => {
    const d = new Date(s.created_at || 0);
    return d >= prior.start && d <= prior.end;
  });
  const priorTotal = sumOwnerRevenue(priorSales);

  if (priorTotal === 0 && currentTotal === 0) {
    return { text: 'No change vs prior period', cls: 'neutral' as const, pct: 0 };
  }
  if (priorTotal === 0) {
    return { text: 'Up from prior period', cls: 'up' as const, pct: null };
  }
  const pct = Math.round(((currentTotal - priorTotal) / priorTotal) * 100);
  if (pct === 0) return { text: 'Flat vs prior period', cls: 'neutral' as const, pct: 0 };
  if (pct > 0) return { text: `+${pct}% vs prior ${range.short}`, cls: 'up' as const, pct };
  return { text: `${pct}% vs prior ${range.short}`, cls: 'down' as const, pct };
}
