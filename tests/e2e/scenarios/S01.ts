import type { Scenario } from './types';

/** Scout pack, one flavour, existing client, paid. */
export const S01: Scenario = {
  id: 'S01',
  title: 'Scout pack, one flavour, existing client, paid',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'addProduct', product: 'scout', flavors: { mint: 1 } },
    { do: 'setClient', name: 'Test Client A' },
    { do: 'charge' },
    { expect: 'saleRecorded', total: 8000 },
  ],
};
