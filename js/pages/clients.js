import { initApp } from '../app.js';
import { loadClients, renderClientsTab, wireClientsPage } from '../clients.js';
import { hydrateFromCache } from '../bootstrap.js';
import { setPageLoading } from '../utils.js';

async function boot() {
  hydrateFromCache();
  setPageLoading(true);

  try {
    await initApp('clients');
    renderClientsTab();
    wireClientsPage();
    await loadClients();
  } finally {
    setPageLoading(false);
  }
}

boot();
