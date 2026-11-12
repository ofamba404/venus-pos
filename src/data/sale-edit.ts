import { adjustInventory, loadSales, type SaleRow } from './entities';
import { deleteSale, patchSale } from './writes/sales';

type SaleItem = {
  product_id?: string;
  product_name?: string;
  detail?: string;
  line_total?: number;
  breakdown?: Record<string, number>;
  [key: string]: unknown;
};

export function saleItems(sale: SaleRow): SaleItem[] {
  return Array.isArray(sale.items) ? (sale.items as SaleItem[]) : [];
}

export function mergeBreakdown(items: SaleItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    for (const [id, qty] of Object.entries(item.breakdown || {})) {
      out[id] = (out[id] || 0) + Math.round(Number(qty) || 0);
    }
  }
  return out;
}

/** Add one unit of the line's first flavour and the same unit price. */
export function bumpFirstLine(items: SaleItem[]): SaleItem[] {
  if (!items.length) return items;
  return items.map((item, index) => {
    if (index !== 0) return item;
    const breakdown = { ...(item.breakdown || {}) };
    const key = Object.keys(breakdown)[0] || 'mint';
    const prev = Math.round(Number(breakdown[key]) || 0);
    const next = prev + 1;
    breakdown[key] = next;
    const line = Math.round(Number(item.line_total) || 0);
    const unit = prev > 0 ? Math.round(line / prev) : line;
    return {
      ...item,
      breakdown,
      line_total: line + unit,
      detail: `${next} × ${key}`,
    };
  });
}

async function applySoldDelta(before: Record<string, number>, after: Record<string, number>) {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const id of ids) {
    const deltaSold = (after[id] || 0) - (before[id] || 0);
    if (!deltaSold) continue;
    await adjustInventory(id, -deltaSold);
  }
}

export async function saveSaleItems(sale: SaleRow, nextItems: SaleItem[]) {
  const before = mergeBreakdown(saleItems(sale));
  const after = mergeBreakdown(nextItems);
  const total = nextItems.reduce((sum, item) => sum + Math.round(Number(item.line_total) || 0), 0);
  await applySoldDelta(before, after);
  const res = await patchSale(
    sale.id,
    {
      items: nextItems,
      total_ugx: total,
      amount_paid_ugx: sale.is_credit ? sale.amount_paid_ugx : total,
    },
    'return=minimal',
  );
  if (!res.ok) throw new Error(`Could not save order (${res.status})`);
  await loadSales({ force: true });
}

export async function voidSaleRecord(sale: SaleRow) {
  const before = mergeBreakdown(saleItems(sale));
  const res = await deleteSale(sale.id);
  if (!res.ok) throw new Error(`Could not void order (${res.status})`);
  await applySoldDelta(before, {});
  await loadSales({ force: true });
}
