import { resetDraftStock } from './state.js';
import { dataStore } from './store/index.js';

export async function prepareOrderContext() {
  resetDraftStock();
  await dataStore.fetchAll(['inventory', 'clients'], { silent: false });
}
