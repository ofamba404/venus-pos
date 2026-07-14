import { COOKIE_COMMISSION_UGX } from './config.js';

/** Cookie qty on a sale line (breakdown key `cookie`). */
export function cookieQtyFromItem(item) {
  const qty = Number(item?.breakdown?.cookie);
  return Number.isFinite(qty) && qty > 0 ? qty : 0;
}

/**
 * Owner revenue for a line: cookies at commission only; everything else at face value.
 * Customer still pays full unit price — this is for analytics, not checkout totals.
 */
export function itemOwnerRevenue(item) {
  const cookieQty = cookieQtyFromItem(item);
  if (cookieQty > 0) return cookieQty * COOKIE_COMMISSION_UGX;
  return Number(item?.line_total) || 0;
}

/** Owner revenue for a sale (sum of adjusted lines). Falls back to total_ugx if no items. */
export function saleOwnerRevenue(sale) {
  const items = sale?.items;
  if (!items?.length) return Number(sale?.total_ugx) || 0;
  return items.reduce((sum, item) => sum + itemOwnerRevenue(item), 0);
}

export function sumOwnerRevenue(list) {
  return list.reduce((sum, s) => sum + saleOwnerRevenue(s), 0);
}
