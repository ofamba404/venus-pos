import { initApp, revealApp } from '../app.js';
import { loadDeliveries, renderDeliveryAnalysis } from '../delivery.js';
import { hydrateFromCache } from '../bootstrap.js';
import { prepareOrderContext } from '../order-context.js';
import { resetPageDataSettled, setPageDataSettled } from '../state.js';
import { setPageLoading } from '../utils.js';

async function boot() {
  resetPageDataSettled();
  hydrateFromCache();
  setPageLoading(true);

  try {
    await initApp('delivery');
    await Promise.all([loadDeliveries(), prepareOrderContext()]);
    setPageDataSettled();
    renderDeliveryAnalysis();
    revealApp();
  } finally {
    setPageLoading(false);
  }
}

boot();
