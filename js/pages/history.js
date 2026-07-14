import { runPageBoot } from '../bootstrap.js';
import { renderOrderHistory } from '../order-history.js';

runPageBoot({
  page: 'history',
  paint: renderOrderHistory,
  entities: ['sales', 'clients', 'inventory'],
  slices: {
    sales: renderOrderHistory,
    clients: renderOrderHistory,
  },
});
