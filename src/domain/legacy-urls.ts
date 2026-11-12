/** Old register URLs and notification hashes from `02-product-spec.md` §2. */

const PAGE_REDIRECTS: Record<string, string> = {
  '/pages/home.html': '/sell',
  '/pages/inventory.html': '/stock',
  '/pages/clients.html': '/clients',
  '/pages/history.html': '/history',
  '/pages/analytics.html': '/insights',
  '/pages/delivery.html': '/delivery',
  '/pages/reviews.html': '/reviews',
  '/pages/admin.html': '/store',
};

function barePath(pathname: string): string {
  const noBase = pathname.replace(/^\/next(?=\/)/, '') || '/';
  const path = noBase.split('?')[0] || '/';
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path || '/';
}

/** Where a legacy URL or hash should land. Null means the current route can handle it. */
export function legacyTarget(pathname: string, hash = ''): string | null {
  const path = barePath(pathname);
  const h = hash || '';
  if (h === '#store-orders' || h.startsWith('#store-orders&') || h.startsWith('#store-orders?')) {
    return '/orders';
  }
  if ((path === '/analytics' || path === '/pages/analytics.html') && h === '#stock') {
    return '/insights#stock';
  }
  return PAGE_REDIRECTS[path] || null;
}
