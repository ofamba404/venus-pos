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

/** Full owner revenue for a sale (ignores credit settlement). */
export function saleOwnerRevenue(sale) {
  const items = sale?.items;
  if (!items?.length) return Number(sale?.total_ugx) || 0;
  return items.reduce((sum, item) => sum + itemOwnerRevenue(item), 0);
}

/**
 * Share of a credit sale that has been collected (0–1).
 * Cash sales and fully cleared credit count as 1.
 */
export function salePaidRatio(sale) {
  if (!sale?.is_credit) return 1;
  if (sale.credit_cleared) return 1;
  const total = Number(sale.total_ugx) || 0;
  if (total <= 0) return 0;
  const paid = Math.min(Math.max(0, Number(sale.amount_paid_ugx) || 0), total);
  return paid / total;
}

/** Owner revenue recognized so far (excludes unpaid credit balance). */
export function saleRecognizedOwnerRevenue(sale) {
  return saleOwnerRevenue(sale) * salePaidRatio(sale);
}

export function sumOwnerRevenue(list) {
  return list.reduce((sum, s) => sum + saleRecognizedOwnerRevenue(s), 0);
}
