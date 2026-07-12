export const SUPABASE_URL = 'https://xiangrykfxlnacthjcad.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_UAR75C14ePR5_mqOez4wjg_mqdlnt5X';
export const GOOGLE_MAPS_API_KEY = 'AIzaSyCrCkJGwRrloiRPW3x91dvWMeVKEecKL7Y';

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
  { id: 'cookie', name: 'Cookies', sub: '', color: '#a6752e' },
];

export const CAT_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
export const FLAVOR_POOL = ['mint', 'strawberry', 'blueberry', 'watermelon', 'grape', 'coconut', 'melon'];
export const SPLIFF_POOL = ['spliff5050', 'spliff7030'];
export const LOW_STOCK_THRESHOLD = 5;

export const PRODUCTS = [
  { id: 'scout', name: 'Scout Pack', price: 8000, joints: 1, rule: 'choose_any' },
  { id: 'pilot', name: 'Pilot Pack', price: 15000, joints: 2, rule: 'choose_any' },
  { id: 'commander', name: "Commander's Stash", price: 35000, joints: 5, rule: 'choose_any' },
  { id: 'variety', name: 'Variety Pack', price: 50000, joints: 8, rule: 'choose_variety' },
  { id: 'plain_single', name: 'Plain', unitPrice: 5000, rule: 'single_qty', categoryId: 'classic', unitLabel: 'per joint' },
  { id: 'spliff_single', name: 'Bangis', unitPrice: 5000, rule: 'spliff_qty' },
  { id: 'cookie_single', name: 'Cookies', unitPrice: 5000, rule: 'single_qty', categoryId: 'cookie', unitLabel: 'per cookie' },
];

export const PAGES = [
  { id: 'home', label: 'Home' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'clients', label: 'Clients' },
  { id: 'delivery', label: 'Delivery' },
  { id: 'analytics', label: 'Analytics' },
];

function inPagesDir() {
  return /\/pages(?:\/|$)/.test(location.pathname);
}

/** Resolve correct href whether the app is served from / or /pages/ */
export function getPageHref(pageId, hash = '') {
  const root = inPagesDir();
  const paths = {
    home: root ? '../index.html' : 'index.html',
    inventory: root ? 'inventory.html' : 'pages/inventory.html',
    clients: root ? 'clients.html' : 'pages/clients.html',
    delivery: root ? 'delivery.html' : 'pages/delivery.html',
    analytics: root ? 'analytics.html' : 'pages/analytics.html',
  };
  return (paths[pageId] || paths.home) + hash;
}
