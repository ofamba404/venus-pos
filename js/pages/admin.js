import { runPageBoot } from '../bootstrap.js';
import { renderAdminPage, wireAdminPage } from '../admin.js';

runPageBoot({
  page: 'admin',
  wire: wireAdminPage,
  paint: renderAdminPage,
  entities: ['clients', 'inventory', 'sales'],
  slices: {
    clients: renderAdminPage,
    inventory: renderAdminPage,
    sales: renderAdminPage,
  },
});
