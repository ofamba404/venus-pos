import { initApp } from '../app.js';
import { renderStockGlance } from '../inventory.js';
import { renderProductList } from '../orders.js';
import { hydrateFromCache, loadPageData } from '../bootstrap.js';
import { setPageLoading } from '../utils.js';
import { updateTodayStrip, wireHomePage } from '../home.js';

async function boot() {
  hydrateFromCache();
  setPageLoading(true);

  try {
    await initApp('home');
    wireHomePage();
    renderProductList();
    updateTodayStrip();
    renderStockGlance();
    await loadPageData();
    updateTodayStrip();
    renderStockGlance();
  } finally {
    setPageLoading(false);
  }
}

boot();
