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

export type SaleItem = {
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

/**
 * A "count" line is sold by the unit: Plain, where the breakdown is a single count. Packs, cookies and
 * wholesale are not counts. A pack holds a fixed set of flavours, so its quantity is one pack per line.
 */
export function isCountLine(item: SaleItem | null | undefined): boolean {
  const product = findProduct(String(item?.product_id || ''));
  if (product) return product.rule === 'single_qty';
  return Object.keys(item?.breakdown || {}).length <= 1;
}

/** How many of a line there are: the unit count for a count line, otherwise one pack. */
export function lineQuantity(item: SaleItem): number {
  if (!isCountLine(item)) return 1;
  return Math.max(1, Math.round(Number(Object.values(item.breakdown || {})[0]) || 1));
}

function sameLine(a: SaleItem, b: SaleItem): boolean {
  return (
    String(a.product_id) === String(b.product_id) &&
    JSON.stringify(Object.entries(a.breakdown || {}).sort()) === JSON.stringify(Object.entries(b.breakdown || {}).sort())
  );
}

/** Price cookie lines across the whole sale the way Sell reprices its cart. Mutates a copy only. */
function reprice(items: SaleItem[]): SaleItem[] {
  const next = items.map((item) => ({ ...item }));
  if (next.some((item) => isCookiePricedProduct(String(item.product_id)))) applyToCartLines(next);
  return next;
}

/**
 * The + and - on a line. A count line changes its count and price per unit. A pack line never changes its
 * flavours: + adds another identical pack as its own line, - removes one of two identical packs.
 */
export function bumpLine(items: SaleItem[], index: number, delta: number): SaleItem[] {
  const target = items[index];
  if (!target || !delta) return items;
  if (isCountLine(target)) return setLineQty(items, index, lineQuantity(target) + delta);
  if (delta > 0) {
    const copy = { ...target, breakdown: { ...(target.breakdown || {}) } };
    return reprice([...items.slice(0, index + 1), copy, ...items.slice(index + 1)]);
  }
  const twin = items.findIndex((item, i) => i !== index && sameLine(item, target));
  if (twin < 0) return items;
  return reprice(items.filter((_, i) => i !== index));
}

/** Can - do anything on this line? A pack needs an identical twin to take one away. */
export function canDecrement(items: SaleItem[], index: number): boolean {
  const target = items[index];
  if (!target) return false;
  if (isCountLine(target)) return lineQuantity(target) > 1;
  return items.some((item, i) => i !== index && sameLine(item, target));
}

/** Add one more of the first line. Kept for the edit flow's + on line 0. */
export function bumpFirstLine(items: SaleItem[]): SaleItem[] {
  return bumpLine(items, 0, 1);
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
    // Only a count line has a quantity. Setting it never touches the flavours of a pack.
    if (!isCountLine(item)) return item;
    const breakdown = { ...(item.breakdown || {}) };
    const key = Object.keys(breakdown)[0] || 'classic';
    const prev = Math.max(1, Math.round(Number(breakdown[key]) || 0) || 1);
    const next = Math.max(1, Math.round(qty));
    breakdown[key] = next;
    const line = Math.round(Number(item.line_total) || 0);
    const unit = prev > 0 ? Math.round(line / prev) : line;
    return { ...item, breakdown, line_total: unit * next, detail: `x${next}` };
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

/** The picker's starting selection for a product, the same as Sell's openConfig. */
export function newItemSelection(product: Product): ConfigSelection {
  if (product.rule === 'single_qty') return { qty: 1 };
  if (product.rule === 'cookie_wholesale') return { _unitPrice: 2500 };
  return {};
}

/**
 * Append a product to a sale. The line is built by the same buildLineFromConfig Sell uses, and cookies are
 * repriced across the whole sale, so a sale edited here totals exactly like one made on Sell.
 */
export function addConfiguredLine(items: SaleItem[], product: Product, selection: ConfigSelection): SaleItem[] {
  const others = items.map((item) => ({ ...item, productId: item.product_id }));
  const built = buildLineFromConfig(product, selection, { otherLines: others });
  const line: SaleItem = {
    product_id: product.id,
    product_name: cookieLineDisplayName(product.id, built.breakdown, product.name),
    detail: built.detail,
    breakdown: built.breakdown,
    line_total: built.lineTotal,
    ...(built.wholesaleUnitPrice ? { wholesale_unit_price: built.wholesaleUnitPrice } : {}),
  };
  return reprice([...items, line]);
}

/** Total of a sale's lines, the figure saved as total_ugx. */
export function saleItemsTotal(items: SaleItem[]): number {
  return items.reduce((sum, item) => sum + Math.round(Number(item.line_total) || 0), 0);
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
