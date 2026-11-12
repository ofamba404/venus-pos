/** Catalog constants and cookie helpers — port of `js/config.js` (no secrets). */

export type CookieFlavor = {
  id: string;
  name: string;
  color: string;
  unitPrice: number;
};

export type Category = {
  id: string;
  name: string;
  sub: string;
  color: string;
  /** Kept for old sales. Not in the live inventory meta. */
  legacy?: boolean;
};

export type Product = {
  id: string;
  name: string;
  price?: number;
  unitPrice?: number;
  joints?: number;
  rule: string;
  flavorPool?: string[];
  slotNoun?: string;
  fixedFlavor?: string;
  categoryId?: string;
  unitLabel?: string;
  priceFrom?: boolean;
  priceLabel?: string;
  /** No longer sold. Stays in the catalog so old sales, held carts and store orders still read. */
  retired?: boolean;
};

export const COOKIE_FLAVORS: CookieFlavor[] = [
  { id: 'butterscotch', name: 'Butterscotch', color: '#D4A355', unitPrice: 5000 },
  { id: 'chocolate', name: 'Chocolate', color: '#5c2e1f', unitPrice: 8000 },
  { id: 'mint', name: 'Mint', color: '#3CB043', unitPrice: 8000 },
  { id: 'strawberry', name: 'Strawberry', color: '#d81e2c', unitPrice: 8000 },
];

export function cookieCategoryId(flavorId: string | null | undefined): string {
  const raw = String(flavorId || '')
    .toLowerCase()
    .replace(/^cookie_/, '');
  return raw ? `cookie_${raw}` : '';
}

export function cookieFlavorIdFromCategory(categoryId: string | null | undefined): string | null {
  const id = String(categoryId || '');
  if (id === 'cookie') return 'butterscotch';
  return id.startsWith('cookie_') ? id.slice('cookie_'.length) : null;
}

export function canonicalInventoryCategoryId(categoryId: string | null | undefined): string {
  const id = String(categoryId || '');
  return id === 'cookie' ? 'cookie_butterscotch' : id;
}

export function normalizeInventoryBreakdown(
  breakdown: Record<string, unknown> | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
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

export function isCookieCategoryId(categoryId: string | null | undefined): boolean {
  const id = String(categoryId || '');
  return id === 'cookie' || id.startsWith('cookie_');
}

export function cookieQtyFromBreakdown(
  breakdown: Record<string, unknown> | null | undefined,
): number {
  if (!breakdown || typeof breakdown !== 'object') return 0;
  return Object.entries(breakdown).reduce((sum, [id, qty]) => {
    if (!isCookieCategoryId(id)) return sum;
    const n = Number(qty);
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
}

export function cookieLineDisplayName(
  productId: string | null | undefined,
  breakdown: Record<string, unknown> | null | undefined,
  fallback = 'Cookies',
): string {
  const id = String(productId || '');
  if (id === 'cookie_duet') return 'Cookie Duet';
  if (id === 'cookie_trio') return 'Cookie Trio';
  if (id === 'cookie_quartet') return 'Cookie Quartet';
  if (id === 'cookie_wholesale') return 'Wholesale cookies';
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

const COOKIE_CATEGORIES: Category[] = COOKIE_FLAVORS.map((f) => ({
  id: cookieCategoryId(f.id),
  name: f.name,
  sub: 'Cookie',
  color: f.color,
}));

export const CATEGORIES: Category[] = [
  { id: 'mint', name: 'Mint', sub: '', color: '#8fd6f0' },
  { id: 'strawberry', name: 'Strawberry', sub: '', color: '#d81e2c' },
  { id: 'blueberry', name: 'Blueberry', sub: '', color: '#3f5bb8' },
  { id: 'watermelon', name: 'Watermelon', sub: '', color: '#f4a6c1' },
  { id: 'grape', name: 'Grape', sub: '', color: '#D5C7E8' },
  { id: 'coconut', name: 'Coconut', sub: '', color: '#ffffff' },
  { id: 'melon', name: 'Melon', sub: '', color: '#ff8c1a' },
  { id: 'classic', name: 'Plain', sub: '', color: '#e3cba7' },
  { id: 'spliff5050', name: 'Bangis', sub: '50/50', color: '#ffd400', legacy: true },
  { id: 'spliff7030', name: 'Bangis', sub: '70/30', color: '#FFFFA5' },
  ...COOKIE_CATEGORIES,
];

export const CAT_MAP: Record<string, Category> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
);

export const FLAVOR_POOL = [
  'mint',
  'strawberry',
  'blueberry',
  'watermelon',
  'grape',
  'coconut',
  'melon',
];
export const SPLIFF_POOL = ['spliff7030'];
export const COOKIE_FLAVOR_POOL = COOKIE_CATEGORIES.map((c) => c.id);
export const COOKIE_CHOICE_POOL = COOKIE_FLAVOR_POOL.filter((id) => id !== 'cookie_butterscotch');

const COOKIE_UNIT_PRICE_BY_ID = Object.fromEntries(
  COOKIE_FLAVORS.map((f) => [cookieCategoryId(f.id), f.unitPrice]),
);

export function cookieUnitPrice(categoryId: string | null | undefined): number {
  const id = String(categoryId || '');
  if (COOKIE_UNIT_PRICE_BY_ID[id] != null) return COOKIE_UNIT_PRICE_BY_ID[id]!;
  if (id === 'cookie') return COOKIE_UNIT_PRICE_BY_ID.cookie_butterscotch || 5000;
  return 5000;
}

export const LOW_STOCK_THRESHOLD = 5;
export const COOKIE_STOCK_CAPACITY = 100;
export const COOKIE_LOW_PCT = 0.3;
export const COOKIE_WHOLESALE_UGX = 2500;
export const COOKIE_WHOLESALE_FLAVORED_UGX = 3000;

export function cookieWholesaleUgx(categoryOrFlavorId: string | null | undefined): number {
  const id = String(categoryOrFlavorId || '')
    .toLowerCase()
    .replace(/^cookie_/, '');
  if (id === 'chocolate' || id === 'mint' || id === 'strawberry') {
    return COOKIE_WHOLESALE_FLAVORED_UGX;
  }
  return COOKIE_WHOLESALE_UGX;
}

export const COOKIE_OWNER_SHARE = 0.45;
export const COOKIE_PARTNER_SETTLE_EVERY = 25;
export const COOKIE_PARTNER_SETTLED_BASELINE = 25;
export const COOKIE_PARTNER_TRACK_FROM_MS = Date.parse('2026-08-12T00:00:00+03:00');

export const PRODUCTS: Product[] = [
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
    id: 'cookie_trio',
    name: 'Cookie Trio',
    price: 21000,
    joints: 3,
    rule: 'choose_any',
    flavorPool: COOKIE_CHOICE_POOL,
    slotNoun: 'cookies',
  },
  {
    id: 'cookie_quartet',
    name: 'Cookie Quartet',
    retired: true,
    price: 25000,
    joints: 4,
    rule: 'choose_variety',
    fixedFlavor: 'cookie_butterscotch',
    flavorPool: COOKIE_CHOICE_POOL,
    slotNoun: 'cookies',
  },
  {
    id: 'plain_single',
    name: 'Plain',
    unitPrice: 5000,
    rule: 'single_qty',
    categoryId: 'classic',
    unitLabel: 'per joint',
  },
  { id: 'spliff_single', name: 'Bangis', unitPrice: 5000, rule: 'spliff_qty' },
  {
    id: 'cookie_single',
    name: 'Cookies',
    unitPrice: 5000,
    rule: 'cookie_qty',
    unitLabel: 'per cookie',
    priceFrom: true,
  },
  {
    id: 'cookie_wholesale',
    name: 'Wholesale cookies',
    rule: 'cookie_wholesale',
    unitLabel: 'per cookie',
    priceLabel: 'set unit price',
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
] as const;
