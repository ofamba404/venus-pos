import { dataStore } from './store/index.js';
import { salesCache } from './state.js';

export function restoreSalesFromCache() {
  return dataStore.hasData('sales');
}

export async function loadSalesToday() {
  await dataStore.fetch('sales');
}

export { salesCache };
