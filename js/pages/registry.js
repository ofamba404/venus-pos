/**
 * Page registry — entities + lazy paint/wire loaders.
 * Keep ROUTE_ENTITIES in sync with js/store/prefetch.js.
 */

export const ROUTE_ENTITIES = {
  home: ['sales', 'inventory'],
  inventory: ['inventory'],
  clients: ['clients', 'sales'],
  delivery: ['deliveries'],
  history: ['sales', 'clients', 'inventory'],
  analytics: ['sales', 'inventory', 'clients'],
  admin: ['clients', 'inventory', 'sales'],
  reviews: [],
};

const loaders = {
  home: async () => {
    const { renderStockGlance } = await import('../inventory.js');
    const { renderProductList } = await import('../orders.js');
    const { updateTodayStrip, wireHomePage } = await import('../home.js');
    return {
      wire: wireHomePage,
      paint: () => {
        renderProductList();
        updateTodayStrip();
        renderStockGlance();
      },
      slices: {
        sales: updateTodayStrip,
        inventory: renderStockGlance,
      },
    };
  },

  inventory: async () => {
    const { renderInventoryGrid, syncInventoryToDom, wireInventoryPage } = await import(
      '../inventory.js'
    );
    return {
      wire: wireInventoryPage,
      paint: () => {
        renderInventoryGrid();
        syncInventoryToDom();
      },
      slices: { inventory: syncInventoryToDom },
    };
  },

  clients: async () => {
    const { renderClientsTab, wireClientsPage } = await import('../clients.js');
    return {
      wire: wireClientsPage,
      paint: renderClientsTab,
      slices: { clients: renderClientsTab, sales: renderClientsTab },
    };
  },

  delivery: async () => {
    const { renderDeliveryAnalysis } = await import('../delivery.js');
    return {
      paint: renderDeliveryAnalysis,
      slices: { deliveries: renderDeliveryAnalysis },
    };
  },

  history: async () => {
    const { renderOrderHistory } = await import('../order-history.js');
    return {
      paint: renderOrderHistory,
      slices: { sales: renderOrderHistory, clients: renderOrderHistory },
    };
  },

  analytics: async () => {
    const {
      renderAnalytics,
      renderAnalyticsCharts,
      renderAnalyticsOverview,
      renderAnalyticsStock,
      wireAnalyticsPage,
    } = await import('../analytics.js');
    return {
      wire: wireAnalyticsPage,
      paint: renderAnalytics,
      slices: {
        sales: [renderAnalyticsOverview, renderAnalyticsCharts],
        inventory: renderAnalyticsStock,
        clients: renderAnalyticsCharts,
      },
      onActivate: () => {
        if (location.hash === '#stock') {
          document.getElementById('stockLevelsLabel')?.scrollIntoView({ block: 'start' });
        }
      },
    };
  },

  reviews: async () => {
    const { loadReviews, renderReviews, wireReviewsPage } = await import('../reviews.js');
    return {
      wire: () => {
        wireReviewsPage();
        void loadReviews();
      },
      paint: renderReviews,
      slices: {},
      /** Re-load reviews when returning to the page if cache is empty. */
      onActivate: () => {
        void loadReviews();
      },
    };
  },

  admin: async () => {
    const { renderAdminPage, wireAdminPage, onAdminActivate } = await import('../admin.js');
    return {
      wire: wireAdminPage,
      paint: renderAdminPage,
      onActivate: onAdminActivate,
      slices: {
        clients: renderAdminPage,
        inventory: renderAdminPage,
        sales: renderAdminPage,
      },
    };
  },
};

const cache = new Map();

export async function loadPageModule(pageId) {
  if (cache.has(pageId)) return cache.get(pageId);
  const loader = loaders[pageId];
  if (!loader) throw new Error(`Unknown page: ${pageId}`);
  const pending = loader().then((mod) => {
    cache.set(pageId, Promise.resolve(mod));
    return mod;
  });
  cache.set(pageId, pending);
  return pending;
}

export function getPageEntities(pageId) {
  return ROUTE_ENTITIES[pageId] ?? [];
}
