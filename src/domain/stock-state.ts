import { COOKIE_LOW_PCT, COOKIE_STOCK_CAPACITY, LOW_STOCK_THRESHOLD, isCookieCategoryId } from './catalog';

export type StockLevel = 'ok' | 'low' | 'out';

export function stockLevel(
  categoryId: string,
  stock: number,
  opts?: { lowThreshold?: number; cookieCapacity?: number; cookieLowPct?: number },
): StockLevel {
  const n = Number(stock) || 0;
  if (n <= 0) return 'out';
  if (isCookieCategoryId(categoryId)) {
    const capacity = opts?.cookieCapacity ?? COOKIE_STOCK_CAPACITY;
    const pct = opts?.cookieLowPct ?? COOKIE_LOW_PCT;
    if (n < capacity * pct) return 'low';
    return 'ok';
  }
  const threshold = opts?.lowThreshold ?? LOW_STOCK_THRESHOLD;
  if (n <= threshold) return 'low';
  return 'ok';
}

/** True when stock crossed from above-threshold into low/out (or recovered). */
export function stockCrossing(
  categoryId: string,
  prev: number,
  next: number,
): { crossedLow: boolean; crossedOut: boolean; recovered: boolean } {
  const before = stockLevel(categoryId, prev);
  const after = stockLevel(categoryId, next);
  return {
    crossedLow: before === 'ok' && after === 'low',
    crossedOut: before !== 'out' && after === 'out',
    recovered: before !== 'ok' && after === 'ok',
  };
}
