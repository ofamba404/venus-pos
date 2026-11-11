import { cookieQtyFromBreakdown, isCookieCategoryId, normalizeInventoryBreakdown } from './catalog';
import { sumOwnerRevenue, type SaleItemLike, type SaleLike } from './revenue';

export type TodaySale = Omit<SaleLike, 'items'> & {
  created_at?: string;
  items?: SaleItemLike[] | Array<Record<string, unknown>> | null;
};

export type TodayStats = {
  revenue: number;
  salesCount: number;
  joints: number;
  cookies: number;
};

function startOfToday(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function salesToday(list: TodaySale[] | null | undefined, now = new Date()): TodaySale[] {
  const start = startOfToday(now).getTime();
  return (list || []).filter((s) => {
    const t = new Date(s.created_at || 0).getTime();
    return Number.isFinite(t) && t >= start;
  });
}

function itemList(sale: TodaySale): Array<Record<string, unknown>> {
  return Array.isArray(sale.items) ? (sale.items as Array<Record<string, unknown>>) : [];
}

function jointsInSale(sale: TodaySale): number {
  return itemList(sale).reduce((sum, item) => {
    const breakdown = normalizeInventoryBreakdown(item.breakdown as Record<string, unknown>);
    return (
      sum +
      Object.entries(breakdown).reduce((inner, [id, qty]) => {
        if (isCookieCategoryId(id)) return inner;
        return inner + Math.max(0, Math.round(Number(qty) || 0));
      }, 0)
    );
  }, 0);
}

function cookiesInSale(sale: TodaySale): number {
  return itemList(sale).reduce(
    (sum, item) => sum + cookieQtyFromBreakdown(item.breakdown as Record<string, unknown>),
    0,
  );
}

export function computeTodayStats(
  list: TodaySale[] | null | undefined,
  now = new Date(),
): TodayStats {
  const todays = salesToday(list, now);
  return {
    revenue: Math.round(sumOwnerRevenue(todays as SaleLike[])),
    salesCount: todays.length,
    joints: todays.reduce((sum, s) => sum + jointsInSale(s), 0),
    cookies: todays.reduce((sum, s) => sum + cookiesInSale(s), 0),
  };
}
