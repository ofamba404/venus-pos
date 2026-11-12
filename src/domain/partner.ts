/**
 * Cookie partner batching helpers — pure slice of `legacy/js/revenue.js`.
 */
import {
  COOKIE_PARTNER_SETTLE_EVERY,
  COOKIE_PARTNER_SETTLED_BASELINE,
  COOKIE_PARTNER_TRACK_FROM_MS,
} from './catalog';
import { cookieBatchProductLines } from './partner-lines';
import { expandCookieUnitsFromItem, type SaleLike, type SaleItemLike } from './revenue';

export { expandCookieUnitsFromItem } from './revenue';
export {
  cookieBatchLineTitle,
  cookieBatchProductLines,
  cookieBatchShareText,
  cookieFlavorMixPhrase,
  cookiePartnerShareText,
} from './partner-lines';

export type PartnerUnit = {
  revenue?: number;
  ownerSplit?: number;
  partnerDue?: number;
  flavorId?: string;
  productKind?: string;
  saleId?: string;
  created_at?: string;
  lineKey?: string;
  lineCookieQty?: number;
};

type PartnerSale = SaleLike & { id?: string; created_at?: string };

export type PartnerBatch = {
  index: number;
  cookieCount: number;
  every: number;
  complete: boolean;
  revenue: number;
  ownerSplit: number;
  partnerDue: number;
  lines: ReturnType<typeof cookieBatchProductLines>;
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
      lines: cookieBatchProductLines(slice),
      revenue: Math.round(totals.revenue),
      ownerSplit: Math.round(totals.ownerSplit),
      partnerDue: Math.round(totals.partnerDue),
    });
  }
  return batches;
}

/** Chronological cookie units from the partner track-from date. Paid ratio is 1, as v1. */
export function expandPartnerUnitsFromSales(sales: PartnerSale[] | null | undefined): PartnerUnit[] {
  const sorted = [...(sales || [])]
    .filter((sale) => new Date(sale.created_at || '').getTime() >= COOKIE_PARTNER_TRACK_FROM_MS)
    .sort(
      (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime(),
    );
  const units: PartnerUnit[] = [];
  for (const sale of sorted) {
    (sale.items || []).forEach((item, itemIndex) => {
      const expanded = expandCookieUnitsFromItem(item as SaleItemLike, 1);
      const lineCookieQty = expanded.length;
      for (const unit of expanded) {
        units.push({
          ...unit,
          saleId: sale.id,
          created_at: sale.created_at,
          lineKey: `${sale.id}:${itemIndex}`,
          lineCookieQty,
        });
      }
    });
  }
  return units;
}

/** Open (unsettled) batches after the baseline of already-settled cookies. */
export function openPartnerBatches(
  sales: PartnerSale[] | null | undefined,
  settledQty: number = COOKIE_PARTNER_SETTLED_BASELINE,
): PartnerBatch[] {
  const units = expandPartnerUnitsFromSales(sales);
  const settled = Math.max(0, Math.round(Number(settledQty) || 0));
  const unsettled = units.slice(settled);
  return cookiePartnerBatchesFromUnits(unsettled, COOKIE_PARTNER_SETTLE_EVERY);
}
