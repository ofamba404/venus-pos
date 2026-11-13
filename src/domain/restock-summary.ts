/**
 * The restock answer, in one headline. Built from `restockPlan` rows:
 * order the urgent flavours with a quantity, and fold the rest into one line.
 */
import { ECONOMICS } from './economics';
import type { RestockRow } from './decisions-book';

export type RestockSummary = {
  headline: string;
  /** Urgent flavours that have an order quantity, most urgent first. */
  order: RestockRow[];
  /** Out of stock and not selling: nothing to order, but worth knowing. */
  idle: RestockRow[];
  /** Everything else with stock on the shelf. */
  fine: RestockRow[];
  /** "9 flavours fine for 2+ weeks", or '' when there are none. */
  fineLine: string;
  weeks: number;
};

export function restockSummary(rows: RestockRow[] | null | undefined, cycleDays = ECONOMICS.restockCycleDays): RestockSummary {
  const list = rows || [];
  const order = list.filter((row) => row.urgent && row.orderQty > 0);
  const rest = list.filter((row) => !order.includes(row));
  const idle = rest.filter((row) => row.stock <= 0);
  const fine = rest.filter((row) => row.stock > 0);
  const weeks = Math.max(1, Math.round(cycleDays / 7));
  const n = order.length;
  return {
    headline: n === 0 ? 'Nothing to restock this cycle' : `Order ${n} flavour${n === 1 ? '' : 's'}`,
    order,
    idle,
    fine,
    fineLine: fine.length ? `${fine.length} flavour${fine.length === 1 ? '' : 's'} fine for ${weeks}+ weeks` : '',
    weeks,
  };
}

/** "Out", "<1 day left", "3 days left". Only meaningful for a row that is selling. */
export function daysLeftLabel(row: Pick<RestockRow, 'stock' | 'daysLeft'>): string {
  if (row.stock <= 0) return 'Out of stock';
  if (row.daysLeft === null) return 'No sales lately';
  if (row.daysLeft < 1) return 'Under a day left';
  const d = Math.round(row.daysLeft);
  if (d >= 14) return `${Math.round(d / 7)} weeks left`;
  return `${d} ${d === 1 ? 'day' : 'days'} left`;
}
