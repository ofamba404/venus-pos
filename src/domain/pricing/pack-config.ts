/**
 * Pure pack / line builders — port of `legacy/js/product-config.js` (no DOM).
 */
import {
  CAT_MAP,
  COOKIE_FLAVOR_POOL,
  FLAVOR_POOL,
  PRODUCTS,
  SPLIFF_POOL,
  cookieQtyFromBreakdown,
  normalizeInventoryBreakdown,
  type Product,
} from '../catalog';
import { formatUGX } from '../format';
import { isCookiePackProduct, lineTotalForCookieProduct } from './flavored-bulk';

const UNIT_PRICE_KEY = '_unitPrice';

export type ConfigSelection = Record<string, number>;

export type BuiltLine = {
  breakdown: Record<string, number>;
  lineTotal: number;
  detail: string;
  wholesaleUnitPrice?: number;
};

export function findProduct(productId: string | null | undefined): Product | undefined {
  return PRODUCTS.find((p) => p.id === productId);
}

/** Fixed flavor for choose_variety packs (Plain for joints; butterscotch for Cookie Quartet). */
export function varietyFixedFlavor(product: Product | null | undefined): string {
  return product?.fixedFlavor || 'classic';
}

/** Selectable flavor pool (defaults to joint FLAVOR_POOL). */
export function varietyFlavorPool(product: Product | null | undefined): string[] {
  return product?.flavorPool || FLAVOR_POOL;
}

function slotNoun(product: Product): string {
  return product?.slotNoun || 'joints';
}

export function productDetailLabel(p: Product): string | undefined {
  if (p.rule === 'single_qty' || p.rule === 'cookie_qty' || p.rule === 'cookie_wholesale') {
    return p.unitLabel;
  }
  if (p.rule === 'spliff_qty') return 'per joint';
  const noun = slotNoun(p);
  const n = p.joints || 0;
  return `${n} ${noun === 'joints' ? (n === 1 ? 'joint' : 'joints') : noun}`;
}

export function wholesaleUnitPriceFromItem(item: {
  wholesaleUnitPrice?: number;
  wholesale_unit_price?: number;
  breakdown?: Record<string, unknown>;
  lineTotal?: number;
  line_total?: number;
} | null | undefined): number {
  const stored = Number(item?.wholesaleUnitPrice ?? item?.wholesale_unit_price);
  if (Number.isFinite(stored) && stored > 0) return Math.round(stored);
  const qty = cookieQtyFromBreakdown(item?.breakdown);
  const total = Number(item?.lineTotal ?? item?.line_total) || 0;
  if (qty > 0 && total > 0) return Math.round(total / qty);
  return 0;
}

export function wholesaleUnitPriceFromSelection(
  configSelection: ConfigSelection | null | undefined,
): number {
  return Math.max(0, Math.round(Number(configSelection?.[UNIT_PRICE_KEY]) || 0));
}

export function breakdownToConfigSelection(
  product: Product | null | undefined,
  breakdown: Record<string, unknown> | null | undefined,
): ConfigSelection {
  if (!product) return {};
  const normalized = normalizeInventoryBreakdown(breakdown);
  if (
    product.rule === 'choose_any' ||
    product.rule === 'spliff_qty' ||
    product.rule === 'cookie_qty' ||
    product.rule === 'cookie_wholesale'
  ) {
    return { ...normalized };
  }
  if (product.rule === 'choose_variety') {
    const sel = { ...normalized };
    delete sel[varietyFixedFlavor(product)];
    return sel;
  }
  if (product.rule === 'single_qty') {
    return { qty: normalized[product.categoryId!] || 0 };
  }
  return {};
}

export function configTotalSelected(configSelection: ConfigSelection | null | undefined): number {
  return Object.entries(configSelection || {}).reduce((sum, [key, value]) => {
    if (String(key).startsWith('_')) return sum;
    return sum + (typeof value === 'number' ? value : 0);
  }, 0);
}

/** Restore flavor qty (+ wholesale unit price) when editing a cart/sale line. */
export function itemToConfigSelection(
  product: Product | null | undefined,
  item: {
    breakdown?: Record<string, unknown>;
    wholesaleUnitPrice?: number;
    wholesale_unit_price?: number;
    lineTotal?: number;
    line_total?: number;
  } | null | undefined,
): ConfigSelection {
  const sel = breakdownToConfigSelection(product, item?.breakdown);
  if (product?.rule === 'cookie_wholesale') {
    const unit = wholesaleUnitPriceFromItem(item);
    if (unit > 0) sel[UNIT_PRICE_KEY] = unit;
  }
  return sel;
}

function pricingOtherLines(options: { otherLines?: unknown[] } = {}): unknown[] {
  return Array.isArray(options.otherLines) ? options.otherLines : [];
}

/**
 * Build cart/sale line fields from a product + config selection.
 * `otherLines` feeds flavoured-cookie bulk pricing across the cart.
 */
export function buildLineFromConfig(
  product: Product,
  configSelection: ConfigSelection,
  options: { otherLines?: unknown[] } = {},
): BuiltLine {
  let breakdown: Record<string, number> = {};
  let lineTotal = 0;
  let detail = '';
  const otherLines = pricingOtherLines(options);

  if (product.rule === 'choose_any') {
    breakdown = { ...configSelection };
    lineTotal = isCookiePackProduct(product.id)
      ? lineTotalForCookieProduct(product, breakdown, otherLines as never[])
      : (product.price as number);
    detail = Object.entries(breakdown)
      .filter(([, qty]) => qty > 0)
      .map(([id, qty]) => `${CAT_MAP[id]?.name || id} x${qty}`)
      .join(', ');
  } else if (product.rule === 'choose_variety') {
    const fixedId = varietyFixedFlavor(product);
    const pool = varietyFlavorPool(product);
    const fixedCat = CAT_MAP[fixedId];
    breakdown = { ...configSelection, [fixedId]: 1 };
    lineTotal = isCookiePackProduct(product.id)
      ? lineTotalForCookieProduct(product, breakdown, otherLines as never[])
      : (product.price as number);
    const choices = pool
      .filter((id) => (configSelection[id] || 0) > 0)
      .map((id) => `${CAT_MAP[id]?.name || id} x${configSelection[id] || 0}`)
      .join(', ');
    detail = choices
      ? `${choices} + ${fixedCat?.name || fixedId}`
      : fixedCat?.name || fixedId;
  } else if (product.rule === 'single_qty') {
    const qty = Number(configSelection.qty) || 0;
    breakdown = { [product.categoryId!]: qty };
    lineTotal = qty * (product.unitPrice as number);
    detail = `x${qty}`;
  } else if (product.rule === 'spliff_qty') {
    SPLIFF_POOL.forEach((id) => {
      const n = Number(configSelection[id]) || 0;
      if (n > 0) breakdown[id] = n;
    });
    const totalQty = Object.values(breakdown).reduce((a, b) => a + b, 0);
    lineTotal = totalQty * (product.unitPrice as number);
    detail = Object.entries(breakdown)
      .map(([id, qty]) => `${CAT_MAP[id]?.sub || id} x${qty}`)
      .join(', ');
  } else if (product.rule === 'cookie_qty') {
    COOKIE_FLAVOR_POOL.forEach((id) => {
      const n = Number(configSelection[id]) || 0;
      if (n > 0) breakdown[id] = n;
    });
    lineTotal = lineTotalForCookieProduct(product, breakdown, otherLines as never[]);
    detail = Object.entries(breakdown)
      .map(([id, qty]) => `${CAT_MAP[id]?.name || id} x${qty}`)
      .join(', ');
  } else if (product.rule === 'cookie_wholesale') {
    COOKIE_FLAVOR_POOL.forEach((id) => {
      const n = Number(configSelection[id]) || 0;
      if (n > 0) breakdown[id] = n;
    });
    const unitPrice = wholesaleUnitPriceFromSelection(configSelection);
    const totalQty = Object.values(breakdown).reduce((a, b) => a + b, 0);
    lineTotal = totalQty * unitPrice;
    const mix = Object.entries(breakdown)
      .map(([id, qty]) => `${CAT_MAP[id]?.name || id} x${qty}`)
      .join(', ');
    detail = unitPrice > 0 ? `${mix} · ${formatUGX(unitPrice)} each` : mix;
  }

  return {
    breakdown,
    lineTotal,
    detail,
    ...(product.rule === 'cookie_wholesale'
      ? { wholesaleUnitPrice: wholesaleUnitPriceFromSelection(configSelection) }
      : {}),
  };
}
