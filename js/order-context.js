import { loadClients } from './clients.js';
import { loadInventory } from './inventory.js';
import { resetDraftStock } from './state.js';

export async function prepareOrderContext() {
  resetDraftStock();
  await Promise.all([loadInventory(), loadClients()]);
}
