import { runPageBoot } from '../bootstrap.js';
import { renderInventoryGrid, syncInventoryToDom, wireInventoryPage } from '../inventory.js';

runPageBoot({
  page: 'inventory',
  wire: wireInventoryPage,
  paint: () => {
    renderInventoryGrid();
    syncInventoryToDom();
  },
  slices: {
    inventory: syncInventoryToDom,
  },
});
