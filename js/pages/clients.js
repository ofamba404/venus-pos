import { finishAppInit, mountApp, revealApp } from '../app.js';
import { loadClients, renderClientsTab, wireClientsPage } from '../clients.js';
import { hydrateFromCache } from '../bootstrap.js';
import { applyPendingFlags, clearPendingFlags } from '../pending.js';
import { resetPageDataSettled, setPageDataSettled } from '../state.js';
import { setPageLoading } from '../utils.js';

async function boot() {
  resetPageDataSettled();
  const cached = hydrateFromCache();
  applyPendingFlags(cached);
  setPageLoading(true);

  try {
    mountApp('clients');
    revealApp();
    wireClientsPage();
    renderClientsTab();

    await Promise.all([finishAppInit(), loadClients()]);
    setPageDataSettled();
    clearPendingFlags();
    renderClientsTab();
  } finally {
    setPageLoading(false);
  }
}

boot();
