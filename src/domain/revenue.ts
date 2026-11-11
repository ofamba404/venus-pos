/**
 * Owner revenue recognition — port of `legacy/js/revenue.js` sale helpers.
 * Cookie settlement uses the same profit-split math as v1.
 */
import {
  COOKIE_OWNER_SHARE,
  cookieFlavorIdFromCategory,
  cookieUnitPrice,
  cookieWholesaleUgx,
  isCookieCategoryId,
  normalizeInventoryBreakdown,
} from './catalog';

export type SaleLike = {
  items?: SaleItemLike[] | null;
  total_ugx?: number;
  is_credit?: boolean;
  credit_cleared?: boolean;
  amount_paid_ugx?: number;
  created_at?: string;
};

export type SaleItemLike = {
  product_id?: string;
  productId?: string;
  product_name?: string;
  name?: string;
  line_total?: number;
  breakdown?: Record<string, unknown>;
};

type FlavorEntry = {
  catId: string;
  flavorId: string;
  qty: number;
  unitPrice: number;
  wholesale: number;
};

function cookieProductKind(item: SaleItemLike | null | undefined) {
  const id = String(item?.product_id || item?.productId || '')
    .toLowerCase()
    .replace(/-/g, '_');
  const name = String(item?.product_name || item?.name || '').toLowerCase();
  if (id.includes('wholesale') || name.includes('wholesale')) return 'wholesale';
  if (id.includes('quartet') || name.includes('quartet')) return 'quartet';
  if (id.includes('trio') || name.includes('trio')) return 'trio';
  if (id.includes('duet') || name.includes('duet')) return 'duet';
  return 'single';
}

export function cookieFlavorEntriesFromItem(item: SaleItemLike | null | undefined): FlavorEntry[] {
  const breakdown = normalizeInventoryBreakdown(item?.breakdown);
  if (!Object.keys(breakdown).length) return [];
  const rows: FlavorEntry[] = [];
  for (const [catId, qtyRaw] of Object.entries(breakdown)) {
    if (!isCookieCategoryId(catId)) continue;
    const qty = Number(qtyRaw);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const flavorId = cookieFlavorIdFromCategory(catId) || 'butterscotch';
    rows.push({
      catId,
      flavorId,
      qty,
      unitPrice: cookieUnitPrice(catId),
      wholesale: cookieWholesaleUgx(flavorId),
    });
  }
  return rows;
}

export function allocateCookieLineRevenue(
  entries: FlavorEntry[],
  revenue: number,
  productKind = 'single',
): number[] {
  const list = entries || [];
  if (!list.length || revenue <= 0) return list.map(() => 0);

  if (
    productKind === 'quartet' ||
    productKind === 'trio' ||
    productKind === 'duet' ||
    productKind === 'wholesale'
  ) {
    const totalQty = list.reduce((sum, e) => sum + e.qty, 0) || 1;
    return list.map((e) => revenue * (e.qty / totalQty));
  }

  const weightSum =
    list.reduce((sum, e) => sum + e.unitPrice * e.qty, 0) ||
    list.reduce((s, e) => s + e.qty, 0);
  return list.map((e) => revenue * ((e.unitPrice * e.qty) / weightSum));
}

/**
 * Expand a cookie line into per-unit shares (for settlement batches).
 * Amounts are scaled by `paidRatio` (credit collections).
 * Zero-revenue lines (rewards) are omitted from partner settlement.
 */
export function expandCookieUnitsFromItem(item: SaleItemLike | null | undefined, paidRatio = 1) {
  const entries = cookieFlavorEntriesFromItem(item);
  const cookieQty = entries.reduce((sum, e) => sum + e.qty, 0);
  if (cookieQty <= 0) return [];

  const revenue = Math.max(0, Number(item?.line_total) || 0) * paidRatio;
  if (revenue <= 0) return [];

  const kind = cookieProductKind(item);
  const allocs = allocateCookieLineRevenue(entries, revenue, kind);
  const units: Array<{
    flavorId: string;
    ownerSplit: number;
    partnerDue: number;
    revenue: number;
    productKind: string;
  }> = [];

  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i]!;
    const alloc = allocs[i] || 0;
    const cost = e.qty * e.wholesale * paidRatio;
    const profit = alloc - cost;
    const ownerTotal = profit > 0 ? profit * COOKIE_OWNER_SHARE : 0;
    const partnerTotal = Math.max(0, alloc - ownerTotal);
    const ownerEach = ownerTotal / e.qty;
    const partnerEach = partnerTotal / e.qty;
    for (let u = 0; u < e.qty; u += 1) {
      units.push({
        flavorId: e.flavorId,
        ownerSplit: ownerEach,
        partnerDue: partnerEach,
        revenue: alloc / e.qty,
        productKind: kind,
      });
    }
  }
  return units;
}

export function itemCookieSettlement(item: SaleItemLike | null | undefined) {
  const entries = cookieFlavorEntriesFromItem(item);
  const cookieQty = entries.reduce((sum, e) => sum + e.qty, 0);
  if (cookieQty <= 0) return null;

  const revenue = Math.max(0, Number(item?.line_total) || 0);
  const wholesale = entries.reduce((sum, e) => sum + e.qty * e.wholesale, 0);
  const allocs = allocateCookieLineRevenue(entries, revenue, cookieProductKind(item));

  let ownerSplit = 0;
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i]!;
    const alloc = allocs[i] || 0;
    const cost = e.qty * e.wholesale;
    const profit = alloc - cost;
    if (profit <= 0) continue;
    ownerSplit += profit * COOKIE_OWNER_SHARE;
  }

  ownerSplit = Math.round(ownerSplit);
  const partnerDue = Math.max(0, Math.round(revenue - ownerSplit));
  return {
    cookieQty,
    revenue,
    wholesale,
    profit: revenue - wholesale,
    ownerSplit,
    partnerDue,
  };
}

export function itemOwnerRevenue(item: SaleItemLike | null | undefined): number {
  const settlement = itemCookieSettlement(item);
  if (settlement) return settlement.ownerSplit;
  return Number(item?.line_total) || 0;
}

export function saleOwnerRevenue(sale: SaleLike | null | undefined): number {
  const items = sale?.items;
  if (!items?.length) return Number(sale?.total_ugx) || 0;
  return items.reduce((sum, item) => sum + itemOwnerRevenue(item), 0);
}

export function salePaidRatio(sale: SaleLike | null | undefined): number {
  if (!sale?.is_credit) return 1;
  if (sale.credit_cleared) return 1;
  const total = Number(sale.total_ugx) || 0;
  if (total <= 0) return 0;
  const paid = Math.min(Math.max(0, Number(sale.amount_paid_ugx) || 0), total);
  return paid / total;
}

export function saleRecognizedOwnerRevenue(sale: SaleLike | null | undefined): number {
  return saleOwnerRevenue(sale) * salePaidRatio(sale);
}

export function sumOwnerRevenue(list: SaleLike[] | null | undefined): number {
  return (list || []).reduce((sum, s) => sum + saleRecognizedOwnerRevenue(s), 0);
}
