import { CATEGORIES } from './config.js';

export const inventory = {};
export const draftStock = {};
export let salesCache = [];
export let clients = [];
export let deliveries = [];

/**
 * Inventory readiness (single concept):
 * - hydrated: a trusted category snapshot was applied (IDB and/or network),
 *   including legitimate all-zero stock.
 * - networkSynced: that snapshot came from (or was confirmed by) a live
 *   server read via the inventory write/ensure API or Supabase.
 *
 * Writes may proceed once hydrated. Boot always tries to network-sync first.
 */
let inventoryHydrated = false;
let inventoryNetworkSynced = false;

export function isInventoryHydrated() {
  return inventoryHydrated;
}

export function markInventoryHydrated(value = true) {
  inventoryHydrated = Boolean(value);
  if (!inventoryHydrated) inventoryNetworkSynced = false;
}

export function isInventoryNetworkSynced() {
  return inventoryNetworkSynced;
}

export function markInventoryNetworkSynced(value = true) {
  inventoryNetworkSynced = Boolean(value);
  if (inventoryNetworkSynced) inventoryHydrated = true;
}

/** Ready for stock edits / checkout deductions. */
export function isInventoryReady() {
  return inventoryHydrated;
}

export function markInventoryReady() {
  markInventoryNetworkSynced(true);
}

export function resetInventoryReady() {
  markInventoryHydrated(false);
}

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
    deliveryEnabled: true,
    deliveryTimeLabel: '',
    deliveryLocationLabel: '',
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
  return cart.reduce((s, i) => s + (i.isReward ? 0 : Number(i.lineTotal) || 0), 0);
}

export function resetDraftStock() {
  CATEGORIES.forEach((c) => {
    draftStock[c.id] = inventory[c.id];
  });
}
