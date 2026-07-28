/**
 * Lightweight regression checks for POS SPA routing / templates.
 * Run: node scripts/check-spa.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  }
}

function resolvePageFromPathname(pathname) {
  if (/admin\.html$/i.test(pathname)) return 'admin';
  if (/inventory\.html$/i.test(pathname)) return 'inventory';
  if (/clients\.html$/i.test(pathname)) return 'clients';
  if (/reviews\.html$/i.test(pathname)) return 'reviews';
  if (/delivery\.html$/i.test(pathname)) return 'delivery';
  if (/history\.html$/i.test(pathname)) return 'history';
  if (/analytics\.html$/i.test(pathname)) return 'analytics';
  if (/home\.html$/i.test(pathname)) return 'home';
  if (/index\.html$/i.test(pathname) || /\/$/.test(pathname) || pathname.endsWith('/venus-pos')) {
    return 'home';
  }
  return null;
}

const pathCases = [
  ['/index.html', 'home'],
  ['/', 'home'],
  ['/pages/inventory.html', 'inventory'],
  ['/pages/admin.html', 'admin'],
  ['/pages/analytics.html', 'analytics'],
  ['/auth.html', null],
  ['/pages/nope.html', null],
];
for (const [p, exp] of pathCases) {
  assert(resolvePageFromPathname(p) === exp, `path ${p} → ${exp}`);
}

function pageIdFromHref(href, base) {
  const url = new URL(href, base);
  if (/auth\.html$/i.test(url.pathname)) return null;
  return resolvePageFromPathname(url.pathname);
}

const hrefCases = [
  ['pages/inventory.html', 'https://x.test/', 'inventory'],
  ['../index.html', 'https://x.test/pages/inventory.html', 'home'],
  ['clients.html', 'https://x.test/pages/inventory.html', 'clients'],
  ['auth.html', 'https://x.test/', null],
];
for (const [h, b, exp] of hrefCases) {
  assert(pageIdFromHref(h, b) === exp, `href ${h} from ${b} → ${exp}`);
}

const pages = ['home', 'inventory', 'clients', 'reviews', 'delivery', 'history', 'analytics', 'admin'];
const templates = fs.readFileSync(path.join(root, 'js/pages/templates.js'), 'utf8');
const registry = fs.readFileSync(path.join(root, 'js/pages/registry.js'), 'utf8');
const layout = fs.readFileSync(path.join(root, 'js/layout.js'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'js/bootstrap.js'), 'utf8');
const router = fs.readFileSync(path.join(root, 'js/router.js'), 'utf8');

for (const p of pages) {
  assert(templates.includes(`${p}:`), `template for ${p}`);
  assert(registry.includes(`${p}:`), `loader for ${p}`);
  const entry = p === 'home' ? 'js/pages/home.js' : `js/pages/${p}.js`;
  const html = p === 'home' ? 'index.html' : `pages/${p}.html`;
  const entrySrc = fs.readFileSync(path.join(root, entry), 'utf8');
  const htmlSrc = fs.readFileSync(path.join(root, html), 'utf8');
  assert(entrySrc.includes(`bootApp('${p}')`), `${entry} boots ${p}`);
  assert(htmlSrc.includes('id="app-root"'), `${html} has app-root`);
  assert(!/\bid="app-root">\s*\n\s*</.test(htmlSrc) || /<div id="app-root"><\/div>/.test(htmlSrc), `${html} shell is empty`);
}

const ids = [
  'todayRevenue',
  'productList',
  'invGrid',
  'clientList',
  'reviewsList',
  'deliveryModel',
  'deliveryTestBench',
  'deliveryLogList',
  'orderHistoryList',
  'statCards',
  'revenueChart',
  'adminBody',
  'amountModal',
  'orderModal',
  'fabNewOrder',
  'page-content',
];
const blob = templates + layout;
for (const id of ids) {
  assert(blob.includes(`id="${id}"`), `missing id=${id}`);
}

// Guardrails against known bugs
assert(!bootstrap.includes("await activatePage('home'"), 'no recursive activatePage deadlock');
assert(router.includes("href.startsWith('#')"), 'hash-only links not intercepted');
assert(router.includes('location.hash'), 'popstate passes hash');
assert(bootstrap.includes('mountAppOnce'), 'uses mountAppOnce');
assert(fs.readFileSync(path.join(root, 'js/store-orders.js'), 'utf8').includes('if (bootstrapped)'), 'store-orders once-guard');
assert(fs.readFileSync(path.join(root, 'js/orders.js'), 'utf8').includes('ordersWired'), 'orders once-guard');

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('SPA regression checks passed');
