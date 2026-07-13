import { dataStore } from './data-store.js';

/**
 * Subscribe to specific entity slices — only re-run affected renderers.
 * Subscriptions stay alive for the page lifetime (MPA unloads on navigate).
 */
export function wireSliceUpdates(slices = {}, { onEntityReady } = {}) {
  const unsubs = [];

  Object.entries(slices).forEach(([entity, fns]) => {
    const handlers = Array.isArray(fns) ? fns : [fns];
    unsubs.push(
      dataStore.subscribe(entity, () => {
        if (dataStore.hasData(entity)) {
          onEntityReady?.(entity);
        }
        handlers.forEach((fn) => {
          try {
            fn();
          } catch (e) {
            console.error(`slice update failed (${entity})`, e);
          }
        });
      }),
    );
  });

  return () => unsubs.forEach((off) => off());
}

export function clearPendingForEntity(entity) {
  document.body.classList.remove(`pending-${entity}`);
  if (entity === 'sales') document.body.classList.remove('pending-today-stats');
  if (entity === 'inventory') document.body.classList.remove('pending-stock-glance');
}
