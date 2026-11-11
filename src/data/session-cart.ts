import { signal, computed } from '@preact/signals';
import {
  cartReducer,
  cartTotal,
  defaultOrderMeta,
  emptyCart,
  type CartAction,
  type CartLine,
  type CartState,
  type OrderMeta,
} from '../domain/cart';
import { KEYS } from './keys';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota */
  }
}

function loadInitial(): CartState {
  const lines = readJson<CartLine[]>(KEYS.cart, []);
  const meta = { ...defaultOrderMeta(), ...readJson<Partial<OrderMeta>>(KEYS.orderMeta, {}) };
  return cartReducer(emptyCart(), { type: 'replace_all', state: { lines, meta } });
}

export const cartState = signal<CartState>(
  typeof sessionStorage !== 'undefined' ? loadInitial() : emptyCart(),
);

export const cartLines = computed(() => cartState.value.lines);
export const orderMeta = computed(() => cartState.value.meta);
export const cartSum = computed(() => cartTotal(cartState.value.lines));
export const cartCount = computed(() => cartState.value.lines.length);

export function dispatchCart(action: CartAction) {
  const next = cartReducer(cartState.value, action);
  cartState.value = next;
  writeJson(KEYS.cart, next.lines);
  writeJson(KEYS.orderMeta, next.meta);
  return next;
}

export function setOrderMetaPatch(meta: Partial<OrderMeta>) {
  return dispatchCart({ type: 'set_meta', meta });
}

export function clearCartKeepMeta() {
  return dispatchCart({ type: 'clear_lines' });
}

export function replaceCart(lines: CartLine[], meta?: Partial<OrderMeta>) {
  return dispatchCart({
    type: 'replace_all',
    state: {
      lines,
      meta: { ...cartState.value.meta, ...(meta || {}) },
    },
  });
}
