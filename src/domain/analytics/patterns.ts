/**
 * Sales heatmap aggregation. Port of `computeSalesPatterns` in
 * `legacy/js/analytics-chart.js`.
 */
import { isCookieCategoryId } from '../catalog';
import { isOutstandingCredit } from '../credit';
import { saleOwnerRevenue, saleRecognizedOwnerRevenue, type SaleLike } from '../revenue';

export type PatternSale = SaleLike & {
  created_at?: string;
  items?: Array<{ breakdown?: Record<string, unknown> | null }> | null;
};

export function computeSalesPatterns(sales: PatternSale[] | null | undefined) {
  const hours = Array(24).fill(0);
  const hourOrders = Array(24).fill(0);
  const weekdays = Array(7).fill(0);
  const weekdayOrders = Array(7).fill(0);
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  const heatOrders = Array.from({ length: 7 }, () => Array(24).fill(0));
  let creditRevenue = 0;
  let paidRevenue = 0;
  let joints = 0;
  let cookies = 0;

  (sales || []).forEach((s) => {
    const d = new Date(s.created_at || 0);
    const h = d.getHours();
    const wd = d.getDay();
    const recognized = saleRecognizedOwnerRevenue(s);
    const full = saleOwnerRevenue(s);
    hours[h] = hours[h]! + recognized;
    hourOrders[h] = hourOrders[h]! + 1;
    weekdays[wd] = weekdays[wd]! + recognized;
    weekdayOrders[wd] = weekdayOrders[wd]! + 1;
    heat[wd]![h] = heat[wd]![h]! + recognized;
    heatOrders[wd]![h] = heatOrders[wd]![h]! + 1;
    if (isOutstandingCredit(s)) {
      paidRevenue += recognized;
      creditRevenue += Math.max(0, full - recognized);
    } else {
      paidRevenue += recognized;
    }
    (s.items || []).forEach((item) => {
      Object.entries(item.breakdown || {}).forEach(([id, qty]) => {
        const n = qty as number;
        if (isCookieCategoryId(id)) cookies += n;
        else joints += n;
      });
    });
  });

  const peakHour = hours.reduce((best, v, i) => (v > best.v ? { v, i } : best), { v: 0, i: 0 });
  const peakWeekday = weekdays.reduce((best, v, i) => (v > best.v ? { v, i } : best), {
    v: 0,
    i: 0,
  });
  const totalPay = paidRevenue + creditRevenue;
  const creditPct = totalPay > 0 ? Math.round((creditRevenue / totalPay) * 100) : 0;
  const unitTotal = joints + cookies;

  const activeHours = hours
    .map((rev, h) => ({ h, rev, orders: hourOrders[h] as number }))
    .filter((x) => x.rev > 0 || x.orders > 0);
  let hourStart = activeHours.length ? Math.min(...activeHours.map((x) => x.h)) : 8;
  let hourEnd = activeHours.length ? Math.max(...activeHours.map((x) => x.h)) : 22;
  if (hourEnd - hourStart < 12) {
    hourStart = Math.max(0, hourStart - 1);
    hourEnd = Math.min(23, hourEnd + 1);
  }
  const hourCols: number[] = [];
  for (let h = hourStart; h <= hourEnd; h += 1) hourCols.push(h);

  let peakCell = { wd: 0, h: 0, rev: 0 };
  for (let wd = 0; wd < 7; wd += 1) {
    for (let h = 0; h < 24; h += 1) {
      const rev = heat[wd]![h]!;
      if (rev > peakCell.rev) peakCell = { wd, h, rev };
    }
  }

  return {
    hourCols,
    heat,
    heatOrders,
    heatMax: Math.max(1, peakCell.rev),
    peakCell,
    peakHour,
    peakWeekday,
    creditPct,
    creditRevenue,
    paidRevenue,
    joints,
    cookies,
    unitTotal,
  };
}
