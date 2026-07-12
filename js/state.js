import { CATEGORIES } from './config.js';

export const inventory = {};
export const draftStock = {};
export let salesCache = [];
export let clients = [];
export let deliveries = [];

CATEGORIES.forEach((c) => {
  inventory[c.id] = 0;
  draftStock[c.id] = 0;
});

const CART_KEY = 'venus-pos-cart';
const ORDER_META_KEY = 'venus-pos-order-meta';

export function getCart() {
  try {
    const raw = sessionStorage.getItem(CART_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function setCart(cart) {
  sessionStorage.setItem(CART_KEY, JSON.stringify(cart));
}

export function getOrderMeta() {
  try {
    const raw = sessionStorage.getItem(ORDER_META_KEY);
    return raw ? JSON.parse(raw) : { clientName: '', clientId: '', isCredit: false };
  } catch {
    return { clientName: '', clientId: '', isCredit: false };
  }
}

export function setOrderMeta(meta) {
  sessionStorage.setItem(ORDER_META_KEY, JSON.stringify(meta));
}

export function cartTotal(cart) {
  return cart.reduce((s, i) => s + i.lineTotal, 0);
}

export function resetDraftStock() {
  CATEGORIES.forEach((c) => {
    draftStock[c.id] = inventory[c.id];
  });
}
