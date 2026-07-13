import { initApp, revealApp } from '../app.js';
import { loadClients, renderClientsTab, wireClientsPage } from '../clients.js';
import { hydrateFromCache } from '../bootstrap.js';
import { resetPageDataSettled, setPageDataSettled } from '../state.js';
import { setPageLoading } from '../utils.js';

async function boot() {
  resetPageDataSettled();
  hydrateFromCache();
  setPageLoading(true);

  try {
    await initApp('clients');
    wireClientsPage();
    await loadClients();
    setPageDataSettled();
    renderClientsTab();
    revealApp();
  } finally {
    setPageLoading(false);
  }
}

boot();
