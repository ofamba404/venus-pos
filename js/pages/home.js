import { initApp, revealApp } from '../app.js';
import { renderStockGlance } from '../inventory.js';
import { renderProductList } from '../orders.js';
import { hydrateFromCache, loadPageData } from '../bootstrap.js';
import { resetPageDataSettled, setPageDataSettled } from '../state.js';
import { setPageLoading } from '../utils.js';
import { updateTodayStrip, wireHomePage } from '../home.js';

async function boot() {
  resetPageDataSettled();
  hydrateFromCache();
  setPageLoading(true);

  try {
    await initApp('home');
    wireHomePage();
    await loadPageData();
    setPageDataSettled();
    renderProductList();
    updateTodayStrip();
    renderStockGlance();
    revealApp();
  } finally {
    setPageLoading(false);
  }
}

boot();
