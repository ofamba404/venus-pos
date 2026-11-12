import { useEffect } from 'preact/hooks';
import { lazy, Suspense } from 'preact/compat';
import type { ComponentType } from 'preact';
import { bootRouter, currentRoute, go, routeId, ROUTES } from './router';
import { hydrateAuth, allowDevBypass, canAccessPath, authReady } from '../data/auth';
import { bootstrapEntities, loadClients, loadDeliveries, loadSales, loadStoreOrders, storeOrders, syncLabel, ensureInventory } from '../data/entities';
import { connectSupabaseRealtime, startFeed } from '../data/realtime';
import { SUPABASE_KEY, SUPABASE_URL } from '../data/env';
import { playOrderChime } from '../platform/order-chime';
import { isFresh } from '../data/freshness';
import { readConnection, scheduleIdlePrefetch, shouldSkipPrefetch, staleEntities } from '../data/prefetch';
import { KEYS } from '../data/keys';
import { SCHEDULE_POLL_MS, tickLocalSchedules } from '../domain/schedule-notify';
import { ToastHost, showToast } from '../ui/ToastHost';
import { IconSell, IconOrders, IconStock, IconMore } from '../ui/icons';
import { SellPage } from '../features/sell/SellPage';

const page = (load: () => Promise<{ default: ComponentType }>) => lazy(load);

const PAGES = {
  sell: SellPage,
  orders: page(() => import('../features/orders/OrdersPage').then((m) => ({ default: m.OrdersPage }))),
  stock: page(() => import('../features/stock/StockPage').then((m) => ({ default: m.StockPage }))),
  more: page(() => import('../features/more/MorePage').then((m) => ({ default: m.MorePage }))),
  settings: page(() => import('../features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage }))),
  clients: page(() => import('../features/clients/ClientsPage').then((m) => ({ default: m.ClientsPage }))),
  history: page(() => import('../features/history/HistoryPage').then((m) => ({ default: m.HistoryPage }))),
  insights: page(() => import('../features/insights/InsightsPage').then((m) => ({ default: m.InsightsPage }))),
  delivery: page(() => import('../features/delivery/DeliveryPage').then((m) => ({ default: m.DeliveryPage }))),
  reviews: page(() => import('../features/reviews/ReviewsPage').then((m) => ({ default: m.ReviewsPage }))),
  store: page(() => import('../features/store/StorePage').then((m) => ({ default: m.StorePage }))),
  system: page(() => import('../features/system/SystemPage').then((m) => ({ default: m.SystemPage }))),
};

const NAV_ICONS = {
  sell: IconSell,
  orders: IconOrders,
  stock: IconStock,
  more: IconMore,
} as const;

export function App() {
  useEffect(() => {
    hydrateAuth();
    bootRouter();
    let stopPrefetch = () => {};
    let alive = true;
    void bootstrapEntities().finally(() => {
      if (!alive) return;
      stopPrefetch = scheduleIdlePrefetch(() => {
        if (shouldSkipPrefetch(readConnection())) return;
        const stale = staleEntities((name) => isFresh(name));
        if (stale.includes('sales')) void loadSales().catch(() => {});
        if (stale.includes('clients')) void loadClients().catch(() => {});
        if (stale.includes('deliveries')) void loadDeliveries().catch(() => {});
        if (stale.includes('inventory')) void ensureInventory().catch(() => {});
      });
    });
    const scheduleTick = window.setInterval(() => {
      try {
        const prefs = JSON.parse(localStorage.getItem(KEYS.notifPrefs) || '{}') as { schedules?: boolean };
        const fired = JSON.parse(localStorage.getItem(KEYS.notifFired) || '{}') as Record<string, string>;
        const next = tickLocalSchedules([], fired, prefs.schedules === true);
        if (next.titles.length) {
          localStorage.setItem(KEYS.notifFired, JSON.stringify(next.fired));
          next.titles.forEach((title) => showToast(title));
        }
      } catch {
        /* private mode or a bad prefs blob */
      }
    }, SCHEDULE_POLL_MS);
    let seenOrders = new Set<string>();
    let ordersPrimed = false;
    const watchOrders = () => {
      void loadStoreOrders()
        .then((rows) => {
          const waiting = rows.filter((row) => row.status === 'pending' || row.status === 'confirmed');
          const ids = waiting.map((row) => row.id);
          if (!ordersPrimed) {
            seenOrders = new Set(ids);
            ordersPrimed = true;
            return;
          }
          const fresh = waiting.filter((row) => row.id && !seenOrders.has(row.id));
          for (const id of ids) seenOrders.add(id);
          if (!fresh.length) return;
          let ordersOn = true;
          try {
            const prefs = JSON.parse(localStorage.getItem(KEYS.notifPrefs) || '{}') as { orders?: boolean };
            ordersOn = prefs.orders !== false;
          } catch {
            ordersOn = true;
          }
          if (!ordersOn) return;
          const message = fresh.length === 1 ? 'New order' : `${fresh.length} new orders`;
          showToast(message, { actionLabel: 'Open', onAction: () => go('/orders') });
          playOrderChime();
        })
        .catch(() => {});
    };
    const stopOrders = startFeed({
      connect: () =>
        connectSupabaseRealtime(
          `${SUPABASE_URL.replace(/^https:/, 'wss:')}/realtime/v1/websocket?apikey=${SUPABASE_KEY}`,
        ),
      refetch: watchOrders,
      pollMs: 4000,
    });
    return () => {
      alive = false;
      stopPrefetch();
      stopOrders();
      window.clearInterval(scheduleTick);
    };
  }, []);

  const ready = authReady.value;
  const route = currentRoute();
  const waitingOrders = storeOrders.value.filter(
    (order) => order.status === 'pending' || order.status === 'confirmed',
  ).length;

  useEffect(() => {
    if (!ready) return;
    if (allowDevBypass()) return;
    if (canAccessPath(route.path)) return;
    showToast("Staff can't open that page");
    go('/sell', { replace: true });
  }, [route.id, ready]);
  const Page = PAGES[route.id];
  const primaryNav = ROUTES.filter((r) => r.nav === 'primary');

  return (
    <div class="shell">
      <header class="shell__top">
        <div class="shell__brand">Venus POS</div>
        <div class="shell__sync" title={syncLabel.value}>
          <span class={`shell__sync-dot ${syncLabel.value === 'live' ? 'is-live' : ''}`} />
          <span class="shell__sync-label">{route.title}</span>
        </div>
      </header>

      <main class="shell__main v-page">
        <Suspense fallback={null}>
          <Page />
        </Suspense>
      </main>

      <nav class="shell__nav" aria-label="Primary">
        {primaryNav.map((r) => {
          const Icon = NAV_ICONS[r.id as keyof typeof NAV_ICONS];
          const on = routeId.value === r.id || (r.id === 'more' && route.nav === 'more');
          return (
            <button
              key={r.id}
              type="button"
              class={`shell__nav-btn ${on ? 'is-on' : ''}`}
              aria-current={on ? 'page' : undefined}
              onClick={() => go(r.path)}
            >
              {Icon ? <Icon /> : null}
              <span>{r.title}</span>
              {r.id === 'orders' && waitingOrders > 0 ? (
                <span class="shell__nav-badge" data-testid="orders-badge">
                  {waitingOrders}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <ToastHost />
    </div>
  );
}
