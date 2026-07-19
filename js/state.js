import { CATEGORIES } from './config.js';

export const inventory = {};
export const draftStock = {};
export let salesCache = [];
export let clients = [];
export let deliveries = [];

let pageDataSettled = false;

/** False until the first fetch on the current page finishes (success or error). */
export function isPageDataSettled() {
  return pageDataSettled;
}

export function setPageDataSettled(value = true) {
  pageDataSettled = value;
}

export function resetPageDataSettled() {
  pageDataSettled = false;
}

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

function defaultOrderMeta() {
  return {
    clientName: '',
    clientId: '',
    isCredit: false,
    clientPhone: '',
    deliveryTimeLabel: '',
    deliveryTimeMode: '',
    deliveryDeliverAt: '',
    storeOrderId: '',
  };
}

export function getOrderMeta() {
  try {
    const raw = sessionStorage.getItem(ORDER_META_KEY);
    return raw ? { ...defaultOrderMeta(), ...JSON.parse(raw) } : defaultOrderMeta();
  } catch {
    return defaultOrderMeta();
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
