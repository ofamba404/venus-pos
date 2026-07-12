import { restoreClientsFromCache } from './clients.js';
import { restoreInventoryFromCache } from './inventory.js';
import { restoreSalesFromCache } from './sales.js';

/** Paint last-known data instantly; network fetch always follows. */
export function hydrateFromCache() {
  restoreSalesFromCache();
  restoreInventoryFromCache();
  restoreClientsFromCache();
}

export async function loadPageData() {
  const { loadSalesToday } = await import('./sales.js');
  const { prepareOrderContext } = await import('./order-context.js');
  return Promise.all([loadSalesToday(), prepareOrderContext()]);
}
