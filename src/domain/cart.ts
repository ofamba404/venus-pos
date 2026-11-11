/**
 * Cart line model + pure reducer (v2). L1-tested; no legacy dual-run pair.
 * Line / meta shapes match `legacy/js/state.js` + `orders.js` cart pushes.
 */
import { cookieLineDisplayName, type Product } from './catalog';
import { applyToCartLines } from './pricing/flavored-bulk';
import {
  buildLineFromConfig,
  type ConfigSelection,
} from './pricing/pack-config';

export type CartLine = {
  key: string;
  productId: string;
  name: string;
  detail: string;
  breakdown: Record<string, number>;
  lineTotal: number;
  wholesaleUnitPrice?: number;
  stockDeferred?: boolean;
  /** Inventory was claimed when the storefront order was placed. */
  stockClaimed?: boolean;
  isReward?: boolean;
  rewardKey?: string;
  pointsCost?: number;
  quantity?: number;
};

export type OrderMeta = {
  clientName: string;
  clientId: string;
  isCredit: boolean;
  clientPhone: string;
  deliveryEnabled: boolean;
  deliveryTimeLabel: string;
  deliveryLocationLabel: string;
  deliveryTimeMode: string;
  deliveryDeliverAt: string;
  storeOrderId: string;
};

export type CartState = {
  lines: CartLine[];
  meta: OrderMeta;
};

export type HeldSale = {
  id: string;
  name: string;
  savedAt: string;
  lines: CartLine[];
  meta: OrderMeta;
};

export type CartAction =
  | { type: 'replace_lines'; lines: CartLine[] }
  | { type: 'add_line'; line: CartLine }
  | { type: 'remove_line'; key: string }
  | { type: 'update_line'; key: string; line: CartLine }
  | { type: 'clear_lines' }
  | { type: 'set_meta'; meta: Partial<OrderMeta> }
  | { type: 'reset_meta' }
  | { type: 'replace_all'; state: CartState };

export const WALK_IN_NAME = 'Walk-in';

/** Paid sale with the Walk-in chip: no client row, `client_id` stays null. */
export function isWalkInCheckout(
  meta: Pick<OrderMeta, 'clientName' | 'clientId'>,
  isCredit: boolean,
): boolean {
  if (isCredit) return false;
  if (String(meta.clientId || '').trim()) return false;
  return String(meta.clientName || '').trim().toLowerCase() === WALK_IN_NAME.toLowerCase();
}

/** Credit never accepts the Walk-in chip. Paid accepts it or any other name. */
export function clientReadyForCharge(
  meta: Pick<OrderMeta, 'clientName' | 'clientId'>,
  isCredit: boolean,
): boolean {
  if (isWalkInCheckout(meta, isCredit)) return true;
  const name = String(meta.clientName || '').trim();
  if (!name) return false;
  if (
    isCredit &&
    !String(meta.clientId || '').trim() &&
    name.toLowerCase() === WALK_IN_NAME.toLowerCase()
  ) {
    return false;
  }
  return true;
}

export function defaultOrderMeta(): OrderMeta {
  return {
    clientName: '',
    clientId: '',
    isCredit: false,
    clientPhone: '',
    deliveryEnabled: true,
    deliveryTimeLabel: '',
    deliveryLocationLabel: '',
    deliveryTimeMode: '',
    deliveryDeliverAt: '',
    storeOrderId: '',
  };
}

export function emptyCart(): CartState {
  return { lines: [], meta: defaultOrderMeta() };
}

export function cartTotal(lines: CartLine[] | null | undefined): number {
  return (lines || []).reduce(
    (sum, item) => sum + (item.isReward ? 0 : Number(item.lineTotal) || 0),
    0,
  );
}

export function cloneLines(lines: CartLine[] | null | undefined): CartLine[] {
  return (Array.isArray(lines) ? lines : []).map((line) => ({
    ...line,
    breakdown:
      line.breakdown && typeof line.breakdown === 'object' ? { ...line.breakdown } : {},
  }));
}

function reprice(lines: CartLine[]): CartLine[] {
  const next = cloneLines(lines);
  applyToCartLines(next);
  return next;
}

export function newLineKey(productId: string, now = Date.now()): string {
  return `${productId}-${now}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Build a counter cart line from product + config (mirrors `addConfiguredItemToCart`). */
export function buildCartLine(
  product: Product,
  configSelection: ConfigSelection,
  options: { otherLines?: CartLine[]; key?: string; now?: number } = {},
): CartLine {
  const otherLines = options.otherLines || [];
  const { breakdown, lineTotal, detail, wholesaleUnitPrice } = buildLineFromConfig(
    product,
    configSelection,
    { otherLines },
  );
  return {
    key: options.key || newLineKey(product.id, options.now),
    productId: product.id,
    name: cookieLineDisplayName(product.id, breakdown, product.name),
    detail,
    breakdown,
    lineTotal,
    ...(wholesaleUnitPrice ? { wholesaleUnitPrice } : {}),
  };
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'replace_lines':
      return { ...state, lines: reprice(action.lines) };
    case 'add_line':
      return { ...state, lines: reprice([...state.lines, action.line]) };
    case 'remove_line':
      return {
        ...state,
        lines: reprice(state.lines.filter((l) => l.key !== action.key)),
      };
    case 'update_line':
      return {
        ...state,
        lines: reprice(
          state.lines.map((l) => (l.key === action.key ? action.line : l)),
        ),
      };
    case 'clear_lines':
      return { ...state, lines: [] };
    case 'set_meta':
      return { ...state, meta: { ...state.meta, ...action.meta } };
    case 'reset_meta':
      return { ...state, meta: defaultOrderMeta() };
    case 'replace_all':
      return {
        lines: reprice(action.state.lines),
        meta: { ...defaultOrderMeta(), ...action.state.meta },
      };
    default:
      return state;
  }
}

/** Held-sale snapshot (D6). Store orders cannot be held. */
export function toHeldSale(
  state: CartState,
  opts: { id?: string; name?: string; savedAt?: string; now?: Date } = {},
): HeldSale | null {
  if (state.meta.storeOrderId) return null;
  const now = opts.now || new Date();
  const fallback = `Held ${now.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })}`;
  return {
    id: opts.id || `held-${now.getTime()}`,
    name: String(opts.name || state.meta.clientName || fallback).trim() || fallback,
    savedAt: opts.savedAt || now.toISOString(),
    lines: cloneLines(state.lines),
    meta: { ...state.meta },
  };
}

export function resumeHeldSale(held: HeldSale): CartState {
  return {
    lines: reprice(held.lines),
    meta: { ...defaultOrderMeta(), ...held.meta, storeOrderId: '' },
  };
}
