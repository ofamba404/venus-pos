import {
  COOKIE_BUTTERSCOTCH_OWNER_SHARE,
  COOKIE_FLAVORED_OWNER_SHARE,
  COOKIE_PARTNER_SETTLE_EVERY,
  COOKIE_PARTNER_TRACK_FROM_MS,
  COOKIE_WHOLESALE_UGX,
  cookieFlavorIdFromCategory,
  cookieQtyFromBreakdown,
  cookieUnitPrice,
  isCookieCategoryId,
} from './config.js';

/** v3 — track from Wed 12 Aug 2026; bumps key so prior settle progress clears. */
const COOKIE_SETTLE_STORAGE_KEY = 'venus-cookie-partner-settled-qty-v3';

/** Cookie qty on a sale line (any `cookie_*` or legacy `cookie` breakdown key). */
export function cookieQtyFromItem(item) {
  return cookieQtyFromBreakdown(item?.breakdown);
}

function isButterscotchCookie(catId, flavorId) {
  return catId === 'cookie' || flavorId === 'butterscotch';
}

/**
 * Per-flavor rows on a cookie line (legacy `cookie` → butterscotch).
 * @returns {{ catId: string, flavorId: string, qty: number, unitPrice: number }[]}
 */
export function cookieFlavorEntriesFromItem(item) {
  const breakdown = item?.breakdown;
  if (!breakdown || typeof breakdown !== 'object') return [];
  const rows = [];
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
    });
  }
  return rows;
}

/**
 * Cookie line economics: wholesale, profit, your split, partner due (cost + their split).
 * Pack revenue is allocated across flavors by ala-carte unit-price weights.
 * @returns {{ cookieQty: number, revenue: number, wholesale: number, profit: number, ownerSplit: number, partnerDue: number } | null}
 */
export function itemCookieSettlement(item) {
  const entries = cookieFlavorEntriesFromItem(item);
  const cookieQty = entries.reduce((sum, e) => sum + e.qty, 0);
  if (cookieQty <= 0) return null;

  const revenue = Math.max(0, Number(item?.line_total) || 0);
  const wholesale = cookieQty * COOKIE_WHOLESALE_UGX;
  const weightSum = entries.reduce((sum, e) => sum + e.unitPrice * e.qty, 0) || cookieQty;

  let ownerSplit = 0;
  for (const e of entries) {
    const alloc = revenue * ((e.unitPrice * e.qty) / weightSum);
    const cost = e.qty * COOKIE_WHOLESALE_UGX;
    const profit = alloc - cost;
    if (profit <= 0) continue;
    const share = isButterscotchCookie(e.catId, e.flavorId)
      ? COOKIE_BUTTERSCOTCH_OWNER_SHARE
      : COOKIE_FLAVORED_OWNER_SHARE;
    ownerSplit += profit * share;
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

/**
 * Expand a cookie line into per-unit shares (for 20-cookie settlement batches).
 * Amounts are scaled by `paidRatio` (credit collections).
 * Zero-revenue lines (rewards) are omitted from partner settlement.
 */
export function expandCookieUnitsFromItem(item, paidRatio = 1) {
  const entries = cookieFlavorEntriesFromItem(item);
  const cookieQty = entries.reduce((sum, e) => sum + e.qty, 0);
  if (cookieQty <= 0) return [];

  const revenue = Math.max(0, Number(item?.line_total) || 0) * paidRatio;
  if (revenue <= 0) return [];

  const weightSum = entries.reduce((sum, e) => sum + e.unitPrice * e.qty, 0) || cookieQty;
  const units = [];

  for (const e of entries) {
    const alloc = revenue * ((e.unitPrice * e.qty) / weightSum);
    const cost = e.qty * COOKIE_WHOLESALE_UGX * paidRatio;
    const profit = alloc - cost;
    const share = isButterscotchCookie(e.catId, e.flavorId)
      ? COOKIE_BUTTERSCOTCH_OWNER_SHARE
      : COOKIE_FLAVORED_OWNER_SHARE;
    const ownerTotal = profit > 0 ? profit * share : 0;
    const partnerTotal = Math.max(0, alloc - ownerTotal);
    const ownerEach = ownerTotal / e.qty;
    const partnerEach = partnerTotal / e.qty;
    for (let i = 0; i < e.qty; i += 1) {
      units.push({
        flavorId: e.flavorId,
        ownerSplit: ownerEach,
        partnerDue: partnerEach,
        revenue: alloc / e.qty,
      });
    }
  }
  return units;
}

/** Chronological cookie units from the partner track-from date (oldest first). */
export function cookieUnitsChronological(sales) {
  const sorted = [...(sales || [])]
    .filter((s) => new Date(s.created_at).getTime() >= COOKIE_PARTNER_TRACK_FROM_MS)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const units = [];
  for (const sale of sorted) {
    for (const item of sale.items || []) {
      for (const unit of expandCookieUnitsFromItem(item, 1)) {
        units.push({
          ...unit,
          saleId: sale.id,
          created_at: sale.created_at,
        });
      }
    }
  }
  return units;
}

export function getCookiePartnerSettledQty() {
  try {
    const n = Number(localStorage.getItem(COOKIE_SETTLE_STORAGE_KEY));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export function setCookiePartnerSettledQty(qty) {
  const n = Math.max(0, Math.floor(Number(qty) || 0));
  try {
    localStorage.setItem(COOKIE_SETTLE_STORAGE_KEY, String(n));
  } catch {
    /* ignore quota / private mode */
  }
  return n;
}

/**
 * Partner settlement snapshot: progress toward every N cookies, your split, amount to send.
 */
export function cookiePartnerSettlementSummary(sales) {
  const units = cookieUnitsChronological(sales);
  const totalCookies = units.length;
  let settledQty = getCookiePartnerSettledQty();
  if (settledQty > totalCookies) settledQty = setCookiePartnerSettledQty(totalCookies);

  const unsettled = units.slice(settledQty);
  const unsettledCount = unsettled.length;
  const every = COOKIE_PARTNER_SETTLE_EVERY;
  const readyBatches = Math.floor(unsettledCount / every);
  const readyCount = readyBatches * every;
  const progressInCycle = unsettledCount % every;
  const towardNext = readyBatches > 0 ? every : progressInCycle;

  const sumSlice = (slice) =>
    slice.reduce(
      (acc, u) => {
        acc.ownerSplit += u.ownerSplit;
        acc.partnerDue += u.partnerDue;
        acc.revenue += u.revenue;
        return acc;
      },
      { ownerSplit: 0, partnerDue: 0, revenue: 0 },
    );

  const unsettledTotals = sumSlice(unsettled);
  const readySlice = readyCount > 0 ? unsettled.slice(0, readyCount) : [];
  const readyTotals = sumSlice(readySlice);

  const lifetime = units.reduce(
    (acc, u) => {
      acc.ownerSplit += u.ownerSplit;
      acc.partnerDue += u.partnerDue;
      acc.revenue += u.revenue;
      return acc;
    },
    { ownerSplit: 0, partnerDue: 0, revenue: 0 },
  );

  return {
    every,
    totalCookies,
    settledQty,
    unsettledCount,
    readyBatches,
    readyCount,
    towardNext,
    /** Open batch (everything not yet marked sent). */
    batchOwnerSplit: Math.round(unsettledTotals.ownerSplit),
    batchPartnerDue: Math.round(unsettledTotals.partnerDue),
    batchRevenue: Math.round(unsettledTotals.revenue),
    /** Complete 20-cookie chunks ready to send now. */
    readyOwnerSplit: Math.round(readyTotals.ownerSplit),
    readyPartnerDue: Math.round(readyTotals.partnerDue),
    readyRevenue: Math.round(readyTotals.revenue),
    lifetimeOwnerSplit: Math.round(lifetime.ownerSplit),
    lifetimePartnerDue: Math.round(lifetime.partnerDue),
    lifetimeRevenue: Math.round(lifetime.revenue),
  };
}

/** Mark the next complete 20-cookie batch(es) as sent to partner. */
export function markCookiePartnerBatchesSent(sales) {
  const summary = cookiePartnerSettlementSummary(sales);
  if (summary.readyCount <= 0) return summary;
  setCookiePartnerSettledQty(summary.settledQty + summary.readyCount);
  return cookiePartnerSettlementSummary(sales);
}

/**
 * Owner revenue for a line: cookies at your profit split only; everything else at face value.
 * Customer still pays full unit price — this is for analytics, not checkout totals.
 */
export function itemOwnerRevenue(item) {
  const settlement = itemCookieSettlement(item);
  if (settlement) return settlement.ownerSplit;
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
