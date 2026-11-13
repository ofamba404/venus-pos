/**
 * The money picture: sales and profit per day, week or month for a chart range.
 * Each bucket splits into the owner's share, the helper's share and the cookie partner's cut,
 * using the same `profitPicture` rules as the rest of Insights. What is left of sales after
 * those three is joint cost.
 */
import { rangeBounds, type ChartRange } from './analytics/periods';
import { profitPicture, type DecisionSale } from './decisions';
import { mondayOfWeek } from './history-groups';
import type { JointCostRow } from './joint-cost';
import type { Economics } from './economics';
import { salePaidRatio } from './revenue';

export type MoneyUnit = 'day' | 'week' | 'month';

export type MoneyFigures = {
  /** Paid revenue from the items sold. Rewards are free, so they are not sales. */
  sales: number;
  owner: number;
  helper: number;
  partner: number;
  /** Joint cost: what is left of sales after the three shares. Never below 0. */
  costs: number;
  /** Profit before the helper is paid: the owner's share plus the helper's. The partner's cut is not profit. */
  profit: number;
};

export type MoneyBucket = MoneyFigures & {
  key: string;
  label: string;
  /** Full label for the readout, e.g. "Tue 10 Nov" or "Week of 10 Nov". */
  title: string;
  start: Date;
  end: Date;
  orders: number;
};

export type MoneyChart = {
  unit: MoneyUnit;
  buckets: MoneyBucket[];
  totals: MoneyFigures & { orders: number };
  /** The tallest bar's sales, never 0, so a bar's height is `sales / max`. */
  max: number;
};

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

/** Paid revenue of one sale's items. A credit sale counts for what has been paid so far. */
export function saleSalesUgx(sale: DecisionSale): number {
  const ratio = salePaidRatio(sale);
  if (ratio <= 0) return 0;
  let sum = 0;
  for (const item of sale.items || []) {
    if (item.is_reward) continue;
    sum += Math.max(0, Number(item.line_total) || 0);
  }
  return sum * ratio;
}

function figures(sales: DecisionSale[], history: JointCostRow[] | null | undefined, rates?: Partial<Economics>): MoneyFigures {
  const picture = profitPicture(sales, history, rates);
  const total = Math.round(sales.reduce((sum, sale) => sum + saleSalesUgx(sale), 0));
  const shares = picture.owner + picture.helper + picture.partner;
  return {
    sales: total,
    owner: picture.owner,
    helper: picture.helper,
    partner: picture.partner,
    costs: Math.max(0, total - shares),
    profit: picture.owner + picture.helper,
  };
}

/** Day buckets up to a month, weeks up to about four months, then months. */
export function moneyUnitFor(spanDays: number): MoneyUnit {
  if (spanDays <= 31) return 'day';
  if (spanDays <= 130) return 'week';
  return 'month';
}

function dayLabel(d: Date, short: boolean) {
  return short
    ? d.toLocaleDateString('en-GB', { weekday: 'short' })
    : String(d.getDate());
}

type Slot = { start: Date; end: Date; label: string; title: string };

function slotsFor(unit: MoneyUnit, start: Date, end: Date): Slot[] {
  const slots: Slot[] = [];
  if (unit === 'day') {
    const span = Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / 86_400_000) + 1;
    for (let i = 0; i < span; i += 1) {
      const day = new Date(start);
      day.setDate(day.getDate() + i);
      slots.push({
        start: startOfDay(day),
        end: endOfDay(day),
        label: dayLabel(day, span <= 7),
        title: day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
      });
    }
    return slots;
  }
  if (unit === 'week') {
    let cursor = mondayOfWeek(start);
    while (cursor <= end) {
      const last = new Date(cursor);
      last.setDate(last.getDate() + 6);
      const label = cursor.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      slots.push({ start: new Date(cursor), end: endOfDay(last), label, title: `Week of ${label}` });
      cursor = new Date(cursor);
      cursor.setDate(cursor.getDate() + 7);
    }
    return slots;
  }
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end) {
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    slots.push({
      start: startOfDay(cursor),
      end: endOfDay(last),
      label: cursor.toLocaleDateString('en-GB', { month: 'short' }),
      title: cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return slots;
}

/**
 * The chart for a range. `sales` should be the whole book: the range is applied here, so every
 * bucket and the totals agree. An empty book gives no buckets.
 */
export function moneyChart(
  sales: DecisionSale[] | null | undefined,
  range: ChartRange,
  history: JointCostRow[] | null | undefined,
  now = new Date(),
  rates?: Partial<Economics>,
): MoneyChart {
  const book = (sales || []).filter((sale) => !Number.isNaN(new Date(sale.created_at || '').getTime()));
  const bounds = rangeBounds(range, now);
  let start: Date;
  let end: Date;
  if (bounds) {
    start = bounds.start;
    end = bounds.end;
  } else {
    if (!book.length) {
      return { unit: 'day', buckets: [], totals: { ...figures([], history, rates), orders: 0 }, max: 1 };
    }
    const first = Math.min(...book.map((sale) => new Date(sale.created_at!).getTime()));
    start = startOfDay(new Date(first));
    end = endOfDay(now);
  }
  const spanDays = Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / 86_400_000) + 1;
  const unit = moneyUnitFor(spanDays);
  const inRange = book.filter((sale) => {
    const at = new Date(sale.created_at!).getTime();
    return at >= start.getTime() && at <= end.getTime();
  });
  const buckets: MoneyBucket[] = slotsFor(unit, start, end).map((slot, i) => {
    const mine = inRange.filter((sale) => {
      const at = new Date(sale.created_at!).getTime();
      return at >= slot.start.getTime() && at <= slot.end.getTime();
    });
    return { key: `${unit}-${i}`, ...slot, orders: mine.length, ...figures(mine, history, rates) };
  });
  return {
    unit,
    buckets,
    totals: { ...figures(inRange, history, rates), orders: inRange.length },
    max: Math.max(1, ...buckets.map((b) => b.sales)),
  };
}

/** "31%" style share, or 0 when there are no sales. */
export function profitMarginPct(f: Pick<MoneyFigures, 'sales' | 'profit'>): number {
  return f.sales > 0 ? Math.round((f.profit / f.sales) * 100) : 0;
}
