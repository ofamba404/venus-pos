import { finishAppInit, mountApp, revealApp } from './app.js';
import { applyPendingFlags, clearPendingFlags } from './pending.js';
import { resetPageDataSettled, setPageDataSettled } from './state.js';
import { dataStore } from './store/index.js';
import { scheduleIdlePrefetch, wireNavPrefetch } from './store/prefetch.js';
import { clearPendingForEntity, wireSliceUpdates } from './store/slice-updates.js';
import { setPageLoading } from './utils.js';

/** Hydrate all entities from IndexedDB — instant paint, no network. */
export async function hydrateFromCache() {
  return dataStore.hydrate();
}

/** Background refresh of all entities — stale-while-revalidate, never blocks render. */
export async function refreshAllData({ force = false } = {}) {
  return dataStore.fetchAll(undefined, { force, silent: false });
}

export async function loadPageData() {
  return dataStore.fetchAll(['sales', 'inventory', 'clients'], { silent: false });
}

function defaultSlices(paint) {
  return Object.fromEntries(dataStore.ENTITIES.map((entity) => [entity, paint]));
}

/**
 * Unified page boot: hydrate → paint → parallel background refresh.
 * Slice map limits re-renders to affected UI regions.
 * Subscriptions stay alive for the page lifetime.
 */
export async function runPageBoot({
  page,
  paint,
  wire,
  prefetch = page === 'home',
  entities,
  slices,
}) {
  // POS session must be valid before any network writes/reads.
  if (window.VenusPosAuth?.ensureStaffSession) {
    const session = await window.VenusPosAuth.ensureStaffSession().catch(() => null);
    if (!session) {
      const href = window.VenusPosAuth.authPageHref?.() || 'auth.html';
      window.location.replace(href);
      return;
    }
    // Staff hitting an admin-only URL → bounce home.
    if (!window.VenusPosAuth.canAccessPage?.(page)) {
      window.location.replace(window.VenusPosAuth.homeHref?.() || 'index.html');
      return;
    }
  }

  resetPageDataSettled();
  const hydrated = await hydrateFromCache();
  applyPendingFlags(hydrated);
  setPageLoading(true);

  const activeSlices = slices ?? defaultSlices(paint);
  wireSliceUpdates(activeSlices, { onEntityReady: clearPendingForEntity });

  try {
    mountApp(page);
    revealApp();
    wire?.();
    paint();

    const refreshEntities = entities ?? dataStore.ENTITIES;
    await Promise.all([finishAppInit(), dataStore.fetchAll(refreshEntities, { silent: false })]);

    const missing = refreshEntities.filter((e) => !dataStore.hasData(e));
    if (missing.length) {
      await dataStore.fetchAll(missing, { force: true, silent: false });
    }

    setPageDataSettled();
    clearPendingFlags();
    paint();

    wireNavPrefetch();
    if (prefetch) scheduleIdlePrefetch();
  } finally {
    setPageLoading(false);
  }
}
