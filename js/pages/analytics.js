import { initApp, revealApp } from '../app.js';
import { renderAnalytics, wireAnalyticsPage } from '../analytics.js';
import { hydrateFromCache, loadPageData } from '../bootstrap.js';
import { resetPageDataSettled, setPageDataSettled } from '../state.js';
import { setPageLoading } from '../utils.js';

async function boot() {
  resetPageDataSettled();
  hydrateFromCache();
  setPageLoading(true);

  try {
    await initApp('analytics');
    wireAnalyticsPage();
    await loadPageData();
    setPageDataSettled();
    renderAnalytics();
    revealApp();
  } finally {
    setPageLoading(false);
  }
}

boot();
