import type { Scenario } from './types';

/** Cookie Duet, existing client, paid — first write-contract scenario. */
export const S01: Scenario = {
  id: 'S01',
  title: 'Cookie Duet, existing client, paid',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    {
      do: 'addProduct',
      product: 'cookie_duet',
      flavors: { cookie_mint: 1, cookie_chocolate: 1 },
    },
    { do: 'setClient', name: 'Test Client A' },
    { do: 'charge' },
    { expect: 'saleRecorded', total: 15000 },
  ],
};
