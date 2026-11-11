/**
 * Cookie partner batching helpers — pure slice of `legacy/js/revenue.js`.
 */
import {
  COOKIE_PARTNER_SETTLE_EVERY,
  COOKIE_PARTNER_SETTLED_BASELINE,
  COOKIE_PARTNER_TRACK_FROM_MS,
} from './catalog';
import {
  expandCookieUnitsFromItem,
  salePaidRatio,
  type SaleLike,
  type SaleItemLike,
} from './revenue';

export { expandCookieUnitsFromItem } from './revenue';

export type PartnerUnit = {
  revenue?: number;
  ownerSplit?: number;
  partnerDue?: number;
};

export type PartnerBatch = {
  index: number;
  cookieCount: number;
  every: number;
  complete: boolean;
  revenue: number;
  ownerSplit: number;
  partnerDue: number;
};

function sumUnitMoney(units: PartnerUnit[]): {
  revenue: number;
  ownerSplit: number;
  partnerDue: number;
} {
  let revenue = 0;
  let ownerSplit = 0;
  let partnerDue = 0;
  for (const u of units) {
    revenue += Number(u.revenue) || 0;
    ownerSplit += Number(u.ownerSplit) || 0;
    partnerDue += Number(u.partnerDue) || 0;
  }
  return { revenue, ownerSplit, partnerDue };
}

/** Chunk chronological cookie units into settlement batches of `every`. */
export function cookiePartnerBatchesFromUnits(
  units: PartnerUnit[] | null | undefined,
  every: number = COOKIE_PARTNER_SETTLE_EVERY,
): PartnerBatch[] {
  const size = Math.max(1, Number(every) || COOKIE_PARTNER_SETTLE_EVERY);
  const list = units || [];
  const batches: PartnerBatch[] = [];
  for (let offset = 0; offset < list.length; offset += size) {
    const slice = list.slice(offset, offset + size);
    const totals = sumUnitMoney(slice);
    batches.push({
      index: batches.length + 1,
      cookieCount: slice.length,
      every: size,
      complete: slice.length === size,
      revenue: Math.round(totals.revenue),
      ownerSplit: Math.round(totals.ownerSplit),
      partnerDue: Math.round(totals.partnerDue),
    });
  }
  return batches;
}

export function cookieBatchShareText(batch: PartnerBatch & { lines?: Array<{ text?: string }> } | null): string {
  if (!batch) return '';
  const lines = (batch.lines || []).map((row) => String(row.text || ''));
  lines.push('');
  lines.push(`${batch.cookieCount} cookies — ${Math.round(batch.revenue)}`);
  lines.push(`Your split — ${Math.round(batch.ownerSplit)}`);
  lines.push(`Send partner — ${Math.round(batch.partnerDue)}`);
  return lines.join('\n');
}

export function expandPartnerUnitsFromSales(sales: SaleLike[] | null | undefined): PartnerUnit[] {
  const units: PartnerUnit[] = [];
  for (const sale of sales || []) {
    const created = new Date(sale.created_at || 0).getTime();
    if (!Number.isFinite(created) || created < COOKIE_PARTNER_TRACK_FROM_MS) continue;
    const paidRatio = salePaidRatio(sale);
    for (const item of sale.items || []) {
      for (const unit of expandCookieUnitsFromItem(item as SaleItemLike, paidRatio)) {
        units.push(unit);
      }
    }
  }
  return units;
}

/** Open (unsettled) batches after the baseline of already-settled cookies. */
export function openPartnerBatches(
  sales: SaleLike[] | null | undefined,
  settledQty: number = COOKIE_PARTNER_SETTLED_BASELINE,
): PartnerBatch[] {
  const units = expandPartnerUnitsFromSales(sales);
  const settled = Math.max(0, Math.round(Number(settledQty) || 0));
  const unsettled = units.slice(settled);
  return cookiePartnerBatchesFromUnits(unsettled, COOKIE_PARTNER_SETTLE_EVERY);
}
