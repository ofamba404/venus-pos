import type { Scenario } from './types';

export const S21: Scenario = {
  id: 'S21',
  title: 'Pending order → load → confirm → checkout',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'loadStoreOrder', id: 'seed-pending-order' },
    { do: 'confirmStoreOrder' },
    { do: 'setClient', name: 'Store Customer' },
    { do: 'charge' },
    { expect: 'saleRecorded', total: 8000 },
  ],
};

export const S22: Scenario = {
  id: 'S22',
  title: 'Cancel a pending order',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'cancelStoreOrder', id: 'seed-pending-order' },
    { expect: 'toast', message: 'cancelled' },
  ],
};

export const S23: Scenario = {
  id: 'S23',
  title: 'Dismiss a cancelled order',
  role: 'pos_staff',
  seed: 'default',
  steps: [{ do: 'dismissStoreOrder', id: 'seed-cancelled-order' }, { expect: 'noWrites' }],
};

export const S24: Scenario = {
  id: 'S24',
  title: 'Two orders loaded; check out the second',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'loadStoreOrder', id: 'seed-order-a' },
    { do: 'loadStoreOrder', id: 'seed-order-b' },
    { do: 'setClient', name: 'Store Customer B' },
    { do: 'charge' },
    { expect: 'saleRecorded', total: 15000 },
  ],
};

export const S25: Scenario = {
  id: 'S25',
  title: 'Counter cart parked while store order reviewed',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'addProduct', product: 'scout', flavors: { mint: 1 } },
    { do: 'parkCounterCart' },
    { do: 'loadStoreOrder', id: 'seed-pending-order' },
    { do: 'restoreCounterCart' },
    { do: 'setClient', name: 'Test Client A' },
    { do: 'charge' },
    { expect: 'saleRecorded', total: 8000 },
  ],
};

export const S26: Scenario = {
  id: 'S26',
  title: 'New order arrives while on Sell',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'go', path: '/sell' },
    { do: 'arriveStoreOrder' },
    { expect: 'toast', message: 'order' },
  ],
};

export const S27: Scenario = {
  id: 'S27',
  title: 'Deep link load-store-order opens cart',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'go', path: '/sell#load-store-order=seed-pending-order' },
    { expect: 'display', values: { cartLines: 1 } },
  ],
};

export const S28: Scenario = {
  id: 'S28',
  title: 'Busy 30 min then clear',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'setStoreBusy', minutes: 30 },
    { do: 'setStoreBusy', minutes: null },
    { expect: 'display', values: { busy: 'off' } },
  ],
};

export const S29: Scenario = {
  id: 'S29',
  title: '+1 and −1 on joint and cookie flavours',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'adjustStock', categoryId: 'mint', delta: 1 },
    { do: 'adjustStock', categoryId: 'mint', delta: -1 },
    { do: 'adjustStock', categoryId: 'cookie_mint', delta: 1 },
    { do: 'adjustStock', categoryId: 'cookie_mint', delta: -1 },
    { expect: 'stock', categoryId: 'mint', qty: 20 },
  ],
};

export const S30: Scenario = {
  id: 'S30',
  title: 'Set an exact stock count via keypad',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'setStockCount', categoryId: 'mint', qty: 12 },
    { expect: 'stock', categoryId: 'mint', qty: 12 },
  ],
};

export const S31: Scenario = {
  id: 'S31',
  title: 'Bulk adjust by +24',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'adjustStock', categoryId: 'strawberry', delta: 24 },
    // Seed strawberry is 3 (06-testing low mix). +24 displays 27.
    { expect: 'stock', categoryId: 'strawberry', qty: 27 },
  ],
};

export const S32: Scenario = {
  id: 'S32',
  title: 'inventory/write 502 → direct PATCH fallback',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'adjustStock', categoryId: 'mint', delta: 1 },
    // Seed mint is 20 so a +1 fallback displays 21.
    { expect: 'stock', categoryId: 'mint', qty: 21 },
  ],
};

export const S33: Scenario = {
  id: 'S33',
  title: 'Stock crosses low threshold after a sale → notification once',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    // Threshold is 5. 5 → 4 is low. 1 → 0 would be out.
    { do: 'setStockCount', categoryId: 'mint', qty: 5 },
    { do: 'addProduct', product: 'scout', flavors: { mint: 1 } },
    { do: 'setClient', name: 'Test Client A' },
    { do: 'charge' },
    { expect: 'toast', message: 'low' },
  ],
};
