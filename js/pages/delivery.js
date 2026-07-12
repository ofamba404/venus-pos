import { initApp } from '../app.js';
import { loadDeliveries } from '../delivery.js';
import { prepareOrderContext } from '../order-context.js';
import { setPageLoading } from '../utils.js';

async function boot() {
  setPageLoading(true);
  await initApp('delivery');
  await loadDeliveries();
  await prepareOrderContext();
  setPageLoading(false);
}

boot();
