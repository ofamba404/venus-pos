export const SUPABASE_URL = 'https://xiangrykfxlnacthjcad.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_UAR75C14ePR5_mqOez4wjg_mqdlnt5X';
/** Legacy anon JWT — required for Edge Function calls (store-auth admin). */
export const SUPABASE_ANON_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhpYW5ncnlrZnhsbmFjdGhqY2FkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxMjI2MDIsImV4cCI6MjA5ODY5ODYwMn0.O4IQo4aGqcSzWhE9H1szByvoblo07e7Pm3EL3v182b8';
export const GOOGLE_MAPS_API_KEY = 'AIzaSyCrCkJGwRrloiRPW3x91dvWMeVKEecKL7Y';

/** Web Push VAPID public key (private key lives in Netlify env `VAPID_PRIVATE_KEY`). */
export const VAPID_PUBLIC_KEY =
  'BFnscOwOMzgLqNfjhxeGJ8lfii156h-gBuSbv2vMp2XBPDrv1r6DofpbGHHIzeXG7AUf2ae8Fpa42lJJcWwM6D0';

/**
 * Cookie flavors — add a row here to introduce a new flavor across POS inventory,
 * sales breakdowns, and (via store mappings) the storefront.
 * Category ids are `cookie_<id>` so they never collide with joint flavors.
 * `unitPrice` is the ala-carte single price (matches storefront catalog).
 */
export const COOKIE_FLAVORS = [
  { id: 'butterscotch', name: 'Butterscotch', color: '#D4A355', unitPrice: 5000 },
  { id: 'chocolate', name: 'Chocolate', color: '#5c2e1f', unitPrice: 8000 },
  { id: 'mint', name: 'Mint', color: '#3CB043', unitPrice: 8000 },
  { id: 'strawberry', name: 'Strawberry', color: '#d81e2c', unitPrice: 8000 },
];

export function cookieCategoryId(flavorId) {
  const raw = String(flavorId || '').toLowerCase().replace(/^cookie_/, '');
  return raw ? `cookie_${raw}` : '';
}

export function cookieFlavorIdFromCategory(categoryId) {
  const id = String(categoryId || '');
  if (id === 'cookie') return 'butterscotch';
  return id.startsWith('cookie_') ? id.slice('cookie_'.length) : null;
}

/** Legacy shared bucket → butterscotch (the original cookie SKU). */
export function canonicalInventoryCategoryId(categoryId) {
  const id = String(categoryId || '');
  return id === 'cookie' ? 'cookie_butterscotch' : id;
}

/** Merge breakdown keys so leftover `cookie` deducts from `cookie_butterscotch`. */
export function normalizeInventoryBreakdown(breakdown) {
  const out = {};
  if (!breakdown || typeof breakdown !== 'object') return out;
  for (const [id, qtyRaw] of Object.entries(breakdown)) {
    const n = Number(qtyRaw);
    if (!Number.isFinite(n) || n === 0) continue;
    const canon = canonicalInventoryCategoryId(id);
    if (!canon) continue;
    out[canon] = (out[canon] || 0) + n;
  }
  return out;
}

/** True for per-flavor cookie categories and legacy aggregate `cookie`. */
export function isCookieCategoryId(categoryId) {
  const id = String(categoryId || '');
  return id === 'cookie' || id.startsWith('cookie_');
}

export function cookieQtyFromBreakdown(breakdown) {
  if (!breakdown || typeof breakdown !== 'object') return 0;
  return Object.entries(breakdown).reduce((sum, [id, qty]) => {
    if (!isCookieCategoryId(id)) return sum;
    const n = Number(qty);
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
}

/**
 * Cart/order label for cookie lines — matches storefront titles
 * (Butterscotch Cookie, Cookie Duet, …) instead of generic "Cookies".
 */
export function cookieLineDisplayName(productId, breakdown, fallback = 'Cookies') {
  const id = String(productId || '');
  if (id === 'cookie_duet') return 'Cookie Duet';
  if (id === 'cookie_quartet') return 'Cookie Quartet';
  if (id !== 'cookie_single') return fallback;

  const flavors = Object.entries(breakdown || {})
    .filter(([catId, qty]) => isCookieCategoryId(catId) && Number(qty) > 0)
    .map(([catId]) => {
      const flavor = cookieFlavorIdFromCategory(catId);
      if (!flavor) return '';
      const named = COOKIE_FLAVORS.find((f) => f.id === flavor);
      return named?.name || flavor.charAt(0).toUpperCase() + flavor.slice(1);
    })
    .filter(Boolean);

  if (flavors.length === 1) return `${flavors[0]} Cookie`;
  return fallback;
}

const COOKIE_CATEGORIES = COOKIE_FLAVORS.map((f) => ({
  id: cookieCategoryId(f.id),
  name: f.name,
  sub: 'Cookie',
  color: f.color,
}));

export const CATEGORIES = [
  { id: 'mint', name: 'Mint', sub: '', color: '#8fd6f0' },
  { id: 'strawberry', name: 'Strawberry', sub: '', color: '#d81e2c' },
  { id: 'blueberry', name: 'Blueberry', sub: '', color: '#3f5bb8' },
  { id: 'watermelon', name: 'Watermelon', sub: '', color: '#f4a6c1' },
  { id: 'grape', name: 'Grape', sub: '', color: '#D5C7E8' },
  { id: 'coconut', name: 'Coconut', sub: '', color: '#ffffff' },
  { id: 'melon', name: 'Melon', sub: '', color: '#ff8c1a' },
  { id: 'classic', name: 'Plain', sub: '', color: '#e3cba7' },
  { id: 'spliff5050', name: 'Bangis', sub: '50/50', color: '#ffd400' },
  { id: 'spliff7030', name: 'Bangis', sub: '70/30', color: '#FFFFA5' },
  ...COOKIE_CATEGORIES,
];

export const CAT_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
export const FLAVOR_POOL = ['mint', 'strawberry', 'blueberry', 'watermelon', 'grape', 'coconut', 'melon'];
export const SPLIFF_POOL = ['spliff5050', 'spliff7030'];
/** POS inventory keys for cookie flavors — order matches COOKIE_FLAVORS. */
export const COOKIE_FLAVOR_POOL = COOKIE_CATEGORIES.map((c) => c.id);
/** Non-butterscotch cookie flavors — Duet picks 2 of these; Quartet adds fixed butterscotch. */
export const COOKIE_CHOICE_POOL = COOKIE_FLAVOR_POOL.filter((id) => id !== 'cookie_butterscotch');

const COOKIE_UNIT_PRICE_BY_ID = Object.fromEntries(
  COOKIE_FLAVORS.map((f) => [cookieCategoryId(f.id), f.unitPrice]),
);

/** Ala-carte unit price for a cookie category id (`cookie_mint`, …). */
export function cookieUnitPrice(categoryId) {
  const id = String(categoryId || '');
  if (COOKIE_UNIT_PRICE_BY_ID[id] != null) return COOKIE_UNIT_PRICE_BY_ID[id];
  // Legacy aggregate `cookie` stock maps to butterscotch pricing.
  if (id === 'cookie') return COOKIE_UNIT_PRICE_BY_ID.cookie_butterscotch || 5000;
  return 5000;
}

export const LOW_STOCK_THRESHOLD = 5;
export const COOKIE_STOCK_CAPACITY = 100;
/** Cookie bar + label below this share of capacity (30 → running low under 30 cookies). */
export const COOKIE_LOW_PCT = 0.3;
/**
 * Wholesale cost per cookie for partner settlement. Profit = sale allocation − this.
 * All flavors split profit 45/55 (you / partner).
 * Your cookie revenue is only your profit split; partner gets the rest (cost + their split).
 * Packs (Duet / Quartet) split pack price evenly across the cookies in the pack.
 */
export const COOKIE_WHOLESALE_UGX = 2500;
/** Chocolate / mint / strawberry wholesale (butterscotch stays COOKIE_WHOLESALE_UGX). */
export const COOKIE_WHOLESALE_FLAVORED_UGX = 3000;

/** Wholesale cost for a cookie category id or flavor id. */
export function cookieWholesaleUgx(categoryOrFlavorId) {
  const id = String(categoryOrFlavorId || '').toLowerCase().replace(/^cookie_/, '');
  if (id === 'chocolate' || id === 'mint' || id === 'strawberry') return COOKIE_WHOLESALE_FLAVORED_UGX;
  return COOKIE_WHOLESALE_UGX;
}
/** Your share of cookie profit (all flavors). Partner gets 1 − this. */
export const COOKIE_OWNER_SHARE = 0.45;
/** Settle with cookie partner every this many cookie units sold. */
export const COOKIE_PARTNER_SETTLE_EVERY = 25;
/**
 * Partner settlement only counts cookie sales from this moment forward
 * (Africa/Kampala). Older sales are ignored until explicitly re-included.
 * Wednesday 12 Aug 2026.
 */
export const COOKIE_PARTNER_TRACK_FROM_MS = Date.parse('2026-08-12T00:00:00+03:00');
/**
 * @deprecated Prefer wholesale split via revenue.js — kept as owner share
 * on a full-price butterscotch single (5000 − 2500) × COOKIE_OWNER_SHARE.
 */
export const COOKIE_COMMISSION_UGX = Math.round(
  (5000 - COOKIE_WHOLESALE_UGX) * COOKIE_OWNER_SHARE,
);

export const PRODUCTS = [
  { id: 'scout', name: 'Scout Pack', price: 8000, joints: 1, rule: 'choose_any' },
  { id: 'pilot', name: 'Pilot Pack', price: 15000, joints: 2, rule: 'choose_any' },
  { id: 'commander', name: "Commander's Stash", price: 35000, joints: 5, rule: 'choose_any' },
  { id: 'variety', name: 'Variety Pack', price: 50000, joints: 8, rule: 'choose_variety' },
  {
    id: 'cookie_duet',
    name: 'Cookie Duet',
    price: 15000,
    joints: 2,
    rule: 'choose_any',
    flavorPool: COOKIE_CHOICE_POOL,
    slotNoun: 'cookies',
  },
  {
    id: 'cookie_quartet',
    name: 'Cookie Quartet',
    price: 25000,
    joints: 4,
    rule: 'choose_variety',
    fixedFlavor: 'cookie_butterscotch',
    flavorPool: COOKIE_CHOICE_POOL,
    slotNoun: 'cookies',
  },
  { id: 'plain_single', name: 'Plain', unitPrice: 5000, rule: 'single_qty', categoryId: 'classic', unitLabel: 'per joint' },
  { id: 'spliff_single', name: 'Bangis', unitPrice: 5000, rule: 'spliff_qty' },
  {
    id: 'cookie_single',
    name: 'Cookies',
    unitPrice: 5000,
    rule: 'cookie_qty',
    unitLabel: 'per cookie',
    priceFrom: true,
  },
];

export const PAGES = [
  { id: 'home', label: 'Home', minRole: 'staff' },
  { id: 'inventory', label: 'Inventory', minRole: 'staff' },
  { id: 'clients', label: 'Clients', minRole: 'admin' },
  { id: 'reviews', label: 'Reviews', minRole: 'admin' },
  { id: 'delivery', label: 'Delivery', minRole: 'admin' },
  { id: 'history', label: 'History', minRole: 'admin' },
  { id: 'analytics', label: 'Analytics', minRole: 'admin' },
];

/** Pages the signed-in user may open (admin sees all). */
export function getNavPages() {
  const auth = typeof window !== 'undefined' ? window.VenusPosAuth : null;
  if (!auth?.getRole) return PAGES;
  return PAGES.filter((p) => auth.canAccessPage(p.id));
}

function inPagesDir() {
  return /\/pages(?:\/|$)/.test(location.pathname);
}

/** Resolve asset paths from root or /pages/ */
export function getAssetHref(filename) {
  const root = inPagesDir();
  return root ? `../assets/${filename}` : `assets/${filename}`;
}

/** Resolve correct href whether the app is served from / or /pages/ */
export function getPageHref(pageId, hash = '') {
  const root = inPagesDir();
  const paths = {
    home: root ? '../index.html' : 'index.html',
    inventory: root ? 'inventory.html' : 'pages/inventory.html',
    clients: root ? 'clients.html' : 'pages/clients.html',
    reviews: root ? 'reviews.html' : 'pages/reviews.html',
    delivery: root ? 'delivery.html' : 'pages/delivery.html',
    history: root ? 'history.html' : 'pages/history.html',
    analytics: root ? 'analytics.html' : 'pages/analytics.html',
    admin: root ? 'admin.html' : 'pages/admin.html',
    auth: root ? '../auth.html' : 'auth.html',
  };
  return (paths[pageId] || paths.home) + hash;
}
