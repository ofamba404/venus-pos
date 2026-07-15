import { runPageBoot } from '../bootstrap.js';
import { renderClientsTab, wireClientsPage } from '../clients.js';

runPageBoot({
  page: 'clients',
  wire: wireClientsPage,
  paint: renderClientsTab,
  entities: ['clients', 'sales'],
  slices: {
    clients: renderClientsTab,
    sales: renderClientsTab,
  },
});
