import { dataStore } from './data-store.js';
import { ROUTE_ENTITIES } from '../pages/registry.js';
import { pageIdFromHref } from '../router.js';

const PREFETCH_ORDER = ['inventory', 'clients', 'deliveries', 'sales'];
const IDLE_TIMEOUT_MS = 2500;

let prefetchScheduled = false;
let navWired = false;

function runWhenIdle(fn) {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(fn, { timeout: IDLE_TIMEOUT_MS });
  } else {
    setTimeout(fn, 120);
  }
}

/** Quietly refresh entities that are missing or stale — used after Home paints. */
export function scheduleIdlePrefetch(entities = PREFETCH_ORDER) {
  if (prefetchScheduled) return;
  prefetchScheduled = true;

  runWhenIdle(async () => {
    const stale = entities.filter((e) => !dataStore.isFresh(e));
    if (stale.length) {
      await dataStore.fetchAll(stale, { silent: true });
    }
    prefetchScheduled = false;
  });
}

/** Prefetch a single entity on nav hover/touch — never blocks navigation. */
export function prefetchEntity(entity) {
  if (dataStore.isFresh(entity)) return;
  dataStore.fetch(entity, { silent: true });
}

export function wireNavPrefetch(root = document) {
  if (navWired) return;
  navWired = true;

  const triggerPrefetch = (href) => {
    const page = pageIdFromHref(href);
    const entities = page ? ROUTE_ENTITIES[page] : null;
    if (!entities?.length) return;
    entities.forEach((entity) => prefetchEntity(entity));
  };

  const onIntent = (event) => {
    const link = event.target?.closest?.('a[href]');
    if (!link) return;
    triggerPrefetch(link.getAttribute('href'));
  };

  // Delegate so soft-nav re-renders of the FAB still prefetch.
  // pointerover bubbles; pointerenter does not.
  root.addEventListener('pointerover', onIntent, true);
  root.addEventListener('focusin', onIntent, true);
  root.addEventListener('touchstart', onIntent, { capture: true, passive: true });
}

export { ROUTE_ENTITIES };
