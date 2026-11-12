import type { Scenario } from './types';

export const S02: Scenario = {
  id: 'S02',
  title: 'Cookie Duet, two flavours, paid',
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

export const S03: Scenario = {
  id: 'S03',
  title: 'Cookie Quartet is no longer sold',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'go', path: '/sell' },
    { expect: 'noProduct', product: 'cookie_quartet' },
  ],
};

export const S04: Scenario = {
  id: 'S04',
  title: 'Four flavoured single cookies → bulk 6,500',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'addProduct', product: 'cookie_single', flavors: { cookie_mint: 4 } },
    { do: 'setClient', name: 'Test Client A' },
    { do: 'charge' },
    { expect: 'saleRecorded', total: 26000 },
  ],
};

export const S05: Scenario = {
  id: 'S05',
  title: 'Cookie Trio + 2 flavoured singles crossing bulk threshold',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    {
      do: 'addProduct',
      product: 'cookie_trio',
      flavors: { cookie_mint: 1, cookie_chocolate: 1, cookie_strawberry: 1 },
    },
    { do: 'addProduct', product: 'cookie_single', flavors: { cookie_mint: 2 } },
    { do: 'setClient', name: 'Test Client A' },
    { do: 'charge' },
    { expect: 'saleRecorded', total: 32500 },
  ],
};

export const S06: Scenario = {
  id: 'S06',
  title: 'Wholesale cookies with custom unit price',
  role: 'pos_admin',
  seed: 'default',
  steps: [
    {
      do: 'addProduct',
      product: 'cookie_wholesale',
      flavors: { cookie_mint: 10 },
      unitPrice: 2500,
    },
    { do: 'setClient', name: 'Test Client A' },
    { do: 'charge' },
    { expect: 'saleRecorded', total: 25000 },
  ],
};

export const S07: Scenario = {
  id: 'S07',
  title: 'Plain × 3',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'addProduct', product: 'plain_single', qty: 3 },
    { do: 'setClient', name: 'Test Client A' },
    { do: 'charge' },
    { expect: 'saleRecorded', total: 15000 },
  ],
};

export const S08: Scenario = {
  id: 'S08',
  title: 'Bangis 70/30 × 1 (50/50 discontinued)',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'addProduct', product: 'spliff_single', flavors: { spliff7030: 1 } },
    { do: 'setClient', name: 'Test Client A' },
    { do: 'charge' },
    { expect: 'saleRecorded', total: 5000 },
  ],
};

export const S09: Scenario = {
  id: 'S09',
  title: "Variety pack + Commander's Stash in one sale",
  role: 'pos_staff',
  seed: 'default',
  steps: [
    {
      do: 'addProduct',
      product: 'variety',
      flavors: {
        mint: 1,
        strawberry: 1,
        blueberry: 1,
        watermelon: 1,
        grape: 1,
        coconut: 1,
        melon: 1,
      },
    },
    {
      do: 'addProduct',
      product: 'commander',
      flavors: { mint: 2, strawberry: 2, blueberry: 1 },
    },
    { do: 'setClient', name: 'Test Client A' },
    { do: 'charge' },
    { expect: 'saleRecorded', total: 85000 },
  ],
};

export const S10: Scenario = {
  id: 'S10',
  title: 'New client created inline at checkout',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'addProduct', product: 'scout', flavors: { mint: 1 } },
    { do: 'setClient', name: 'Brand New Walk-in', create: true },
    { do: 'charge' },
    { expect: 'saleRecorded', total: 8000 },
  ],
};

export const S11: Scenario = {
  id: 'S11',
  title: 'Credit sale for a client with no debt',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'addProduct', product: 'scout', flavors: { mint: 1 } },
    { do: 'setClient', name: 'Test Client A' },
    { do: 'setCredit', value: true },
    { do: 'charge' },
    { expect: 'saleRecorded', total: 8000 },
  ],
};

export const S12: Scenario = {
  id: 'S12',
  title: 'Credit sale with existing debt — stacked confirmation accepted',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'addProduct', product: 'scout', flavors: { mint: 1 } },
    { do: 'setClient', name: 'Client With Debt' },
    { do: 'setCredit', value: true },
    { do: 'confirmStackedDebt', accept: true },
    { do: 'charge' },
    { expect: 'saleRecorded', total: 8000 },
  ],
};

export const S13: Scenario = {
  id: 'S13',
  title: 'Credit sale with existing debt — confirmation declined',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'addProduct', product: 'scout', flavors: { mint: 1 } },
    { do: 'setClient', name: 'Client With Debt' },
    { do: 'setCredit', value: true },
    { do: 'confirmStackedDebt', accept: false },
    { expect: 'noWrites' },
  ],
};

export const S14: Scenario = {
  id: 'S14',
  title: 'Delivery sale with predicted fee',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'addProduct', product: 'scout', flavors: { mint: 1 } },
    { do: 'setClient', name: 'Test Client A' },
    {
      do: 'setDelivery',
      feeUgx: 5000,
      destText: 'Kololo',
      phone: '+256700000001',
      deliverAt: '2026-11-12T15:00:00+03:00',
    },
    { do: 'charge' },
    { expect: 'saleRecorded', total: 8000 },
  ],
};

export const S15: Scenario = {
  id: 'S15',
  title: 'Delivery sale with manually edited fee',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'addProduct', product: 'scout', flavors: { mint: 1 } },
    { do: 'setClient', name: 'Test Client A' },
    { do: 'setDelivery', feeUgx: 7000, feeEdited: true, destText: 'Ntinda' },
    { do: 'charge' },
    { expect: 'saleRecorded', total: 8000 },
  ],
};

export const S16: Scenario = {
  id: 'S16',
  title: 'Edit a cart line before charging',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'addProduct', product: 'scout', flavors: { mint: 1 } },
    { do: 'editLine', product: 'scout', flavors: { strawberry: 1 } },
    { do: 'setClient', name: 'Test Client A' },
    { do: 'charge' },
    { expect: 'saleRecorded', total: 8000 },
  ],
};

export const S17: Scenario = {
  id: 'S17',
  title: 'Remove a line then charge (v2 undo once)',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'addProduct', product: 'scout', flavors: { mint: 1 } },
    { do: 'addProduct', product: 'pilot', flavors: { mint: 1, strawberry: 1 } },
    { do: 'removeLine', product: 'pilot' },
    { do: 'undo' },
    { do: 'removeLine', product: 'pilot' },
    { do: 'setClient', name: 'Test Client A' },
    { do: 'charge' },
    { expect: 'saleRecorded', total: 8000 },
  ],
};

export const S18: Scenario = {
  id: 'S18',
  title: 'Sales POST fails once then retry succeeds',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'addProduct', product: 'scout', flavors: { mint: 1 } },
    { do: 'setClient', name: 'Test Client A' },
    { do: 'charge' },
    { do: 'chargeRetry' },
    { expect: 'saleRecorded', total: 8000 },
  ],
};

export const S19: Scenario = {
  id: 'S19',
  title: 'Double-tap Charge → exactly one sale',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'addProduct', product: 'scout', flavors: { mint: 1 } },
    { do: 'setClient', name: 'Test Client A' },
    { do: 'doubleTapCharge' },
    { expect: 'saleRecorded', total: 8000 },
  ],
};

export const S20: Scenario = {
  id: 'S20',
  title: 'Reward line from storefront order checks out',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'loadStoreOrder', id: 'seed-order-with-reward' },
    { do: 'setClient', name: 'Store Customer' },
    { do: 'charge' },
    { expect: 'saleRecorded', total: 8000 },
  ],
};
