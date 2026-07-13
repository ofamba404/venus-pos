import { finishAppInit, mountApp, revealApp } from '../app.js';
import { renderStockGlance } from '../inventory.js';
import { renderProductList } from '../orders.js';
import { hydrateFromCache, loadPageData } from '../bootstrap.js';
import { resetPageDataSettled, setPageDataSettled } from '../state.js';
import { setPageLoading } from '../utils.js';
import { updateTodayStrip, wireHomePage } from '../home.js';

function paintHome(cached) {
  document.body.classList.toggle('pending-today-stats', !cached.sales);
  document.body.classList.toggle('pending-stock-glance', !cached.inventory);
  renderProductList();
  updateTodayStrip();
  renderStockGlance();
}

async function boot() {
  resetPageDataSettled();
  const cached = hydrateFromCache();
  setPageLoading(true);

  try {
    mountApp('home');
    revealApp();
    wireHomePage();
    paintHome(cached);

    await Promise.all([finishAppInit(), loadPageData()]);
    setPageDataSettled();
    document.body.classList.remove('pending-today-stats', 'pending-stock-glance');
    updateTodayStrip();
    renderStockGlance();
  } finally {
    setPageLoading(false);
  }
}

boot();
