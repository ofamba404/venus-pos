import { cookieLineDisplayName, type Product } from '../domain/catalog';
import {
  applyToCartLines,
  isCookiePricedProduct,
} from '../domain/pricing/flavored-bulk';
import {
  buildLineFromConfig,
  findProduct,
  itemToConfigSelection,
  type ConfigSelection,
} from '../domain/pricing/pack-config';
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

export function setLineQty(items: SaleItem[], index: number, qty: number): SaleItem[] {
  return items.map((item, i) => {
    if (i !== index) return item;
    const breakdown = { ...(item.breakdown || {}) };
    const key = Object.keys(breakdown)[0] || 'mint';
    const prev = Math.max(1, Math.round(Number(breakdown[key]) || 0) || 1);
    const next = Math.max(1, Math.round(qty));
    breakdown[key] = next;
    const line = Math.round(Number(item.line_total) || 0);
    const unit = prev > 0 ? Math.round(line / prev) : line;
    return { ...item, breakdown, line_total: unit * next };
  });
}

export function removeSaleLine(items: SaleItem[], index: number): SaleItem[] {
  return items.filter((_, i) => i !== index);
}

export function addPlainLine(items: SaleItem[]): SaleItem[] {
  return [
    ...items,
    {
      product_id: 'plain_single',
      product_name: 'Plain',
      detail: '1 × Plain',
      line_total: 5000,
      breakdown: { classic: 1 },
    },
  ];
}

/** Rules that pick flavours. Plain is a plain count, so it has nothing to re-pick. */
const FLAVOUR_RULES = new Set(['choose_any', 'choose_variety', 'spliff_qty', 'cookie_qty', 'cookie_wholesale']);

/** The catalog product behind a sale line, when its flavours can be re-picked. */
export function flavourProduct(item: SaleItem | null | undefined): Product | null {
  const product = findProduct(String(item?.product_id || ''));
  return product && FLAVOUR_RULES.has(product.rule) ? product : null;
}

/** The picker's starting point: the sale line's current flavours. */
export function flavourSelection(item: SaleItem): ConfigSelection {
  return itemToConfigSelection(flavourProduct(item), item);
}

/** Total flavours picked, ignoring the wholesale unit-price key. */
export function selectionCount(selection: ConfigSelection): number {
  return Object.entries(selection).reduce(
    (sum, [key, n]) => (key.startsWith('_') ? sum : sum + (Number(n) || 0)),
    0,
  );
}

/**
 * Put new flavours on one sale line. Name, detail, breakdown and price are rebuilt
 * the way Sell builds them, so a changed pack reads the same as a new one.
 */
export function reflavourLine(items: SaleItem[], index: number, selection: ConfigSelection): SaleItem[] {
  const target = items[index];
  const product = flavourProduct(target);
  if (!target || !product) return items;
  const others = items.filter((_, i) => i !== index).map((item) => ({ ...item, productId: item.product_id }));
  const built = buildLineFromConfig(product, selection, { otherLines: others });
  const next = items.map((item, i) =>
    i === index
      ? {
          ...item,
          product_name: cookieLineDisplayName(product.id, built.breakdown, product.name),
          detail: built.detail,
          breakdown: built.breakdown,
          line_total: built.lineTotal,
          ...(built.wholesaleUnitPrice ? { wholesale_unit_price: built.wholesaleUnitPrice } : {}),
        }
      : { ...item },
  );
  if (isCookiePricedProduct(product.id) || next.some((item) => isCookiePricedProduct(String(item.product_id)))) {
    applyToCartLines(next);
  }
  return next;
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

export async function saveSaleEdit(
  sale: SaleRow,
  next: { items: SaleItem[]; clientId: string | null; isCredit: boolean; creditCleared: boolean },
) {
  const before = mergeBreakdown(saleItems(sale));
  const after = mergeBreakdown(next.items);
  const total = next.items.reduce((sum, item) => sum + Math.round(Number(item.line_total) || 0), 0);
  await applySoldDelta(before, after);
  const cleared = next.isCredit ? next.creditCleared : false;
  const res = await patchSale(
    sale.id,
    {
      items: next.items,
      total_ugx: total,
      client_id: next.clientId,
      is_credit: next.isCredit,
      credit_cleared: cleared,
      amount_paid_ugx: next.isCredit && !cleared ? Math.min(total, Math.round(Number(sale.amount_paid_ugx) || 0)) : total,
      ...(cleared ? { cleared_at: new Date().toISOString() } : {}),
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
