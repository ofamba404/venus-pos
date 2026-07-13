import { runPageBoot } from '../bootstrap.js';
import { renderClientsTab, wireClientsPage } from '../clients.js';

runPageBoot({
  page: 'clients',
  wire: wireClientsPage,
  paint: renderClientsTab,
  slices: {
    clients: renderClientsTab,
  },
});
