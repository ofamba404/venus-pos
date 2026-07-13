import { runPageBoot } from '../bootstrap.js';
import { renderStockGlance } from '../inventory.js';
import { renderProductList } from '../orders.js';
import { updateTodayStrip, wireHomePage } from '../home.js';

function paintHome() {
  renderProductList();
  updateTodayStrip();
  renderStockGlance();
}

runPageBoot({
  page: 'home',
  wire: wireHomePage,
  paint: paintHome,
  prefetch: true,
  slices: {
    sales: updateTodayStrip,
    inventory: renderStockGlance,
  },
});
