import { finishAppInit, mountApp, revealApp } from '../app.js';
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
    mountApp('delivery');
    revealApp();
    renderDeliveryAnalysis();

    await Promise.all([finishAppInit(), loadDeliveries(), prepareOrderContext()]);
    setPageDataSettled();
    renderDeliveryAnalysis();
  } finally {
    setPageLoading(false);
  }
}

boot();
