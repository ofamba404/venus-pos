import { signal } from '@preact/signals';
import { legacyTarget } from '../domain/legacy-urls';

export type RouteId =
  | 'sell'
  | 'orders'
  | 'stock'
  | 'more'
  | 'settings'
  | 'clients'
  | 'history'
  | 'insights'
  | 'partner'
  | 'delivery'
  | 'reviews'
  | 'store'
  | 'system';

export type Route = {
  id: RouteId;
  path: string;
  title: string;
  nav?: 'primary' | 'more';
  minRole: 'staff' | 'admin';
};

export const ROUTES: Route[] = [
  { id: 'sell', path: '/sell', title: 'Sell', nav: 'primary', minRole: 'staff' },
  { id: 'orders', path: '/orders', title: 'Orders', nav: 'primary', minRole: 'staff' },
  { id: 'stock', path: '/stock', title: 'Stock', nav: 'primary', minRole: 'staff' },
  { id: 'more', path: '/more', title: 'More', nav: 'primary', minRole: 'staff' },
  { id: 'settings', path: '/settings', title: 'Settings', nav: 'more', minRole: 'staff' },
  { id: 'clients', path: '/clients', title: 'Clients', nav: 'more', minRole: 'admin' },
  { id: 'history', path: '/history', title: 'History', nav: 'more', minRole: 'admin' },
  { id: 'insights', path: '/insights', title: 'Insights', nav: 'more', minRole: 'admin' },
  { id: 'partner', path: '/cookie-partner', title: 'Cookie partner', nav: 'more', minRole: 'admin' },
  { id: 'delivery', path: '/delivery', title: 'Delivery', nav: 'more', minRole: 'admin' },
  { id: 'reviews', path: '/reviews', title: 'Reviews', nav: 'more', minRole: 'admin' },
  { id: 'store', path: '/store', title: 'Hours', nav: 'more', minRole: 'admin' },
  { id: 'system', path: '/system', title: 'System', nav: 'more', minRole: 'admin' },
];

export const routeId = signal<RouteId>('sell');

function pathToId(pathname: string): RouteId {
  const clean = pathname.replace(/^\/next/, '').replace(/\/$/, '') || '/sell';
  const hit = ROUTES.find((r) => r.path === clean || clean.endsWith(r.path));
  if (hit) return hit.id;
  if (clean === '/' || clean === '') return 'sell';
  return 'sell';
}

export function currentRoute() {
  return ROUTES.find((r) => r.id === routeId.value) || ROUTES[0]!;
}

export function go(path: string, opts?: { replace?: boolean }) {
  const hashAt = path.indexOf('#');
  const bare = hashAt >= 0 ? path.slice(0, hashAt) : path;
  const hash = hashAt >= 0 ? path.slice(hashAt) : '';
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const full = `${base}${bare.startsWith('/') ? bare : `/${bare}`}${hash}`;
  if (opts?.replace) history.replaceState({}, '', full);
  else history.pushState({}, '', full);
  routeId.value = pathToId(bare);
}

export function bootRouter() {
  const sync = () => {
    const target = legacyTarget(location.pathname, location.hash);
    if (target) {
      go(target, { replace: true });
      return;
    }
    routeId.value = pathToId(location.pathname);
  };
  sync();
  window.addEventListener('popstate', sync);
  if (pathToId(location.pathname) === 'sell' && !/\/sell\/?$/.test(location.pathname)) {
    const hash = location.hash;
    go('/sell', { replace: true });
    if (hash && location.hash !== hash) history.replaceState({}, '', `${location.pathname}${hash}`);
  }
}
