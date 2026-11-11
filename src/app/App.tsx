import { useEffect } from 'preact/hooks';
import { bootRouter, currentRoute, go, routeId, ROUTES } from './router';
import { hydrateAuth, allowDevBypass, canAccessPath, authReady } from '../data/auth';
import { bootstrapEntities, syncLabel } from '../data/entities';
import { ToastHost } from '../ui/ToastHost';
import { IconSell, IconOrders, IconStock, IconMore, IconSync } from '../ui/icons';
import { SellPage } from '../features/sell/SellPage';
import { OrdersPage } from '../features/orders/OrdersPage';
import { StockPage } from '../features/stock/StockPage';
import { MorePage } from '../features/more/MorePage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { ClientsPage } from '../features/clients/ClientsPage';
import { HistoryPage } from '../features/history/HistoryPage';
import { InsightsPage } from '../features/insights/InsightsPage';
import { DeliveryPage } from '../features/delivery/DeliveryPage';
import { ReviewsPage } from '../features/reviews/ReviewsPage';
import { StorePage } from '../features/store/StorePage';
import { SystemPage } from '../features/system/SystemPage';

const PAGES = {
  sell: SellPage,
  orders: OrdersPage,
  stock: StockPage,
  more: MorePage,
  settings: SettingsPage,
  clients: ClientsPage,
  history: HistoryPage,
  insights: InsightsPage,
  delivery: DeliveryPage,
  reviews: ReviewsPage,
  store: StorePage,
  system: SystemPage,
} as const;

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
    void bootstrapEntities();
  }, []);

  useEffect(() => {
    if (!authReady.value) return;
    if (allowDevBypass()) return;
    if (!canAccessPath(currentRoute().path)) go('/sell', { replace: true });
  }, [routeId.value, authReady.value]);

  const route = currentRoute();
  const Page = PAGES[route.id];
  const primaryNav = ROUTES.filter((r) => r.nav === 'primary');

  return (
    <div class="shell">
      <header class="shell__top">
        <div class="shell__brand">Venus POS</div>
        <div class="shell__sync" title={syncLabel.value}>
          <span class={`shell__sync-dot ${syncLabel.value === 'live' ? 'is-live' : ''}`} />
          <IconSync size={16} />
          <span>{route.title}</span>
        </div>
      </header>

      <main class="shell__main">
        <Page />
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
            </button>
          );
        })}
      </nav>

      <ToastHost />
    </div>
  );
}
