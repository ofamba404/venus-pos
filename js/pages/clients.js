import { finishAppInit, mountApp, revealApp } from '../app.js';
import { loadClients, renderClientsTab, wireClientsPage } from '../clients.js';
import { hydrateFromCache } from '../bootstrap.js';
import { resetPageDataSettled, setPageDataSettled } from '../state.js';
import { setPageLoading } from '../utils.js';

async function boot() {
  resetPageDataSettled();
  hydrateFromCache();
  setPageLoading(true);

  try {
    mountApp('clients');
    revealApp();
    wireClientsPage();
    renderClientsTab();

    await Promise.all([finishAppInit(), loadClients()]);
    setPageDataSettled();
  } finally {
    setPageLoading(false);
  }
}

boot();
