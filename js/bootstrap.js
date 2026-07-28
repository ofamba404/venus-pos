import { finishAppInit, mountAppOnce, revealApp } from './app.js';
import { getPageHref } from './config.js';
import { setActiveNav } from './layout.js';
import { applyPendingFlags, clearPendingFlags } from './pending.js';
import { PAGE_TEMPLATES, PAGE_TITLES } from './pages/templates.js';
import { getPageEntities, loadPageModule } from './pages/registry.js';
import { navigate, resolvePageFromLocation, setActivateHandler, wireSpaNavigation } from './router.js';
import { resetPageDataSettled, setPageDataSettled } from './state.js';
import { dataStore } from './store/index.js';
import { scheduleIdlePrefetch, wireNavPrefetch } from './store/prefetch.js';
import { clearPendingForEntity, wireSliceUpdates } from './store/slice-updates.js';
import { setPageLoading } from './utils.js';
import {
  createPageView,
  getActivePageId,
  hasPageView,
  isPageWired,
  markPageWired,
  showPageView,
} from './view-cache.js';

/** @type {(() => void) | null} */
let unsubSlices = null;
/** @type {Promise<void> | null} */
let bootPromise = null;
let appBooted = false;
/** Serialize activations so rapid tab taps don't race. */
let activateQueue = Promise.resolve();

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

function ensureSessionOrRedirect() {
  return (async () => {
    if (!window.VenusPosAuth?.ensureStaffSession) return true;
    const session = await window.VenusPosAuth.ensureStaffSession().catch(() => null);
    if (!session) {
      const href = window.VenusPosAuth.authPageHref?.() || 'auth.html';
      window.location.replace(href);
      return false;
    }
    return true;
  })();
}

function canAccessOrBounce(pageId) {
  if (!window.VenusPosAuth?.canAccessPage) return true;
  if (window.VenusPosAuth.canAccessPage(pageId)) return true;
  return false;
}

function syncDocumentChrome(pageId) {
  document.body.dataset.page = pageId;
  const title = PAGE_TITLES[pageId];
  if (title) document.title = title;
  setActiveNav(pageId);
}

function runViewTransition(update) {
  if (typeof document.startViewTransition === 'function') {
    return document.startViewTransition(update).finished.catch(() => {});
  }
  update();
  return Promise.resolve();
}

/**
 * Soft-activate a page: keep shell + data + realtime alive.
 * Detached views restore instantly; only stale entities hit the network.
 */
export async function activatePage(pageId, { replace = false, fromPop = false, hash = '' } = {}) {
  const run = async () => {
    let target = pageId;
    let replaceState = replace;
    let targetHash = hash;

    if (!canAccessOrBounce(target)) {
      // Must not recurse into activatePage — that deadlocks the activation queue.
      target = 'home';
      replaceState = true;
      targetHash = '';
    }

    // Same-tab tap: only honor hash jumps.
    if (getActivePageId() === target && !fromPop && !targetHash) {
      syncDocumentChrome(target);
      return;
    }

    const href = getPageHref(target, targetHash);
    if (!fromPop) {
      const method = replaceState ? 'replaceState' : 'pushState';
      const current = location.pathname + location.search + location.hash;
      const nextUrl = new URL(href, location.href);
      const next = nextUrl.pathname + nextUrl.search + nextUrl.hash;
      if (replaceState || current !== next) {
        history[method]({ page: target }, '', next);
      }
    }

    const mod = await loadPageModule(target);
    const entities = getPageEntities(target);

    if (!hasPageView(target)) {
      const html = PAGE_TEMPLATES[target];
      if (!html) throw new Error(`No template for page: ${target}`);
      createPageView(target, html);
    }

    const prev = getActivePageId();
    const swap = () => {
      showPageView(target);
      syncDocumentChrome(target);
    };
    if (prev == null) {
      swap();
    } else {
      await runViewTransition(swap);
    }

    // Slice listeners only for the active page — avoids painting detached DOM.
    unsubSlices?.();
    unsubSlices = wireSliceUpdates(mod.slices ?? defaultSlices(mod.paint), {
      onEntityReady: clearPendingForEntity,
    });

    if (!isPageWired(target)) {
      mod.wire?.();
      markPageWired(target);
    } else {
      // Returning visits: optional refresh hook (e.g. reviews inbox).
      mod.onActivate?.();
    }

    mod.paint?.();

    const cold = entities.filter((e) => !dataStore.hasSnapshot(e));
    const staleWarm = entities.filter((e) => dataStore.hasSnapshot(e) && !dataStore.isFresh(e));

    if (cold.length) {
      setPageLoading(true);
      try {
        await dataStore.fetchAll(cold, { silent: false });
        if (getActivePageId() === target) mod.paint?.();
      } finally {
        setPageLoading(false);
      }
    }

    setPageDataSettled();
    clearPendingFlags();
    if (getActivePageId() === target) mod.paint?.();

    if (staleWarm.length) {
      void dataStore.fetchAll(staleWarm, { silent: true });
    }

    if (target === 'home' && prev !== 'home') {
      scheduleIdlePrefetch();
    }

    if (targetHash) {
      const id = targetHash.replace(/^#/, '');
      const el =
        document.getElementById(id) ||
        (id === 'stock' ? document.getElementById('stockLevelsLabel') : null) ||
        (id === 'quote-lab' ? document.getElementById('deliveryTestBench') : null);
      el?.scrollIntoView?.({ block: 'start' });
    }
  };

  activateQueue = activateQueue.then(run, run);
  return activateQueue;
}

/**
 * One-time app boot: session → hydrate → shell → runtimes → first page.
 * Subsequent tab changes call activatePage only.
 */
export async function bootApp(initialPage) {
  if (bootPromise) return bootPromise;

  bootPromise = (async () => {
    const ok = await ensureSessionOrRedirect();
    if (!ok) return;

    const pageId = initialPage || resolvePageFromLocation() || 'home';
    if (!canAccessOrBounce(pageId)) {
      // Staff on admin URL → home
      history.replaceState({ page: 'home' }, '', getPageHref('home'));
    }
    const startPage = canAccessOrBounce(pageId) ? pageId : 'home';

    resetPageDataSettled();
    const hydrated = await hydrateFromCache();
    applyPendingFlags(hydrated);

    mountAppOnce(startPage);
    setActivateHandler(activatePage);
    wireSpaNavigation();
    wireNavPrefetch();

    appBooted = true;
    await activatePage(startPage, { replace: true });
    revealApp();
    void finishAppInit();

    if (startPage === 'home') scheduleIdlePrefetch();
  })();

  return bootPromise;
}

export function isAppBooted() {
  return appBooted;
}

/**
 * @deprecated Prefer bootApp — kept for any leftover direct callers.
 * Unified page boot used by the old MPA entries.
 */
export async function runPageBoot({
  page,
  paint,
  wire,
  prefetch = page === 'home',
  entities,
  slices,
}) {
  // Bridge: if something still calls runPageBoot, boot the SPA then activate.
  await bootApp(page);
  if (paint || wire || slices || entities) {
    // Page modules already registered via activatePage; ignore legacy args.
  }
  if (prefetch) scheduleIdlePrefetch();
}

// Re-export navigate for page modules (home KPI taps, etc.)
export { navigate };
