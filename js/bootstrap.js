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

    setPageDataSettled();
    clearPendingFlags();
    paint();

    wireNavPrefetch();
    if (prefetch) scheduleIdlePrefetch();
  } finally {
    setPageLoading(false);
  }
}
