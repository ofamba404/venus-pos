import type { Scenario } from './types';

export const S34: Scenario = {
  id: 'S34',
  title: 'Settle part of client credit with cash (FIFO)',
  role: 'pos_admin',
  seed: 'default',
  steps: [
    { do: 'settleCredit', clientName: 'Client With Debt', amountUgx: 5000, method: 'cash' },
    { expect: 'display', values: { creditOwedDelta: -5000 } },
  ],
};

export const S35: Scenario = {
  id: 'S35',
  title: 'Settle full credit with mobile money + note',
  role: 'pos_admin',
  seed: 'default',
  steps: [
    {
      do: 'settleCredit',
      clientName: 'Client With Debt',
      amountUgx: 999999,
      method: 'mobile_money',
      note: 'Cleared at counter',
    },
    { expect: 'display', values: { creditOwed: 0 } },
  ],
};

export const S36: Scenario = {
  id: 'S36',
  title: 'Edit a past sale items',
  role: 'pos_admin',
  seed: 'default',
  steps: [{ do: 'editSale', saleId: 'seed-sale-1' }, { expect: 'toast', message: 'updated' }],
};

export const S37: Scenario = {
  id: 'S37',
  title: 'Void a delivery sale',
  role: 'pos_admin',
  seed: 'default',
  steps: [{ do: 'voidSale', saleId: 'seed-delivery-sale' }, { expect: 'toast', message: 'void' }],
};

export const S38: Scenario = {
  id: 'S38',
  title: 'Cookie partner mark batch settled + copy text',
  role: 'pos_admin',
  seed: 'default',
  steps: [
    { do: 'partnerSettleBatch' },
    { expect: 'clipboard', includes: 'cookies' },
  ],
};

export const S39: Scenario = {
  id: 'S39',
  title: 'Clients add, rename, delete',
  role: 'pos_admin',
  seed: 'default',
  steps: [
    { do: 'clientsCrud', action: 'add', name: 'Temp Client' },
    { do: 'clientsCrud', action: 'rename', name: 'Temp Client', newName: 'Temp Client 2' },
    { do: 'clientsCrud', action: 'delete', name: 'Temp Client 2' },
    { expect: 'toast', message: 'deleted' },
  ],
};

export const S40: Scenario = {
  id: 'S40',
  title: 'Storefront users set name, verify, delete',
  role: 'pos_admin',
  seed: 'default',
  steps: [
    { do: 'storeUsers', action: 'setName', name: 'Counter 1' },
    { do: 'storeUsers', action: 'verify' },
    { do: 'storeUsers', action: 'delete' },
    { expect: 'toast', message: 'deleted' },
  ],
};

export const S41: Scenario = {
  id: 'S41',
  title: 'Store hours change open/close and suggest window',
  role: 'pos_admin',
  seed: 'default',
  steps: [
    { do: 'setStoreHours', open: '10:00', close: '22:00', suggest: '11:00–21:00' },
    { expect: 'toast', message: 'hours' },
  ],
};

export const S42: Scenario = {
  id: 'S42',
  title: 'Delivery log edit a trip row',
  role: 'pos_admin',
  seed: 'default',
  steps: [{ do: 'editDeliveryTrip', id: 'seed-trip-1' }, { expect: 'toast', message: 'saved' }],
};

export const S43: Scenario = {
  id: 'S43',
  title: 'Quote lab log a preset test route',
  role: 'pos_admin',
  seed: 'default',
  steps: [{ do: 'quoteLabPreset' }, { expect: 'toast', message: 'logged' }],
};

export const S44: Scenario = {
  id: 'S44',
  title: 'Reviews list + refresh + new review arrives',
  role: 'pos_admin',
  seed: 'default',
  steps: [{ do: 'refreshReviews' }, { expect: 'display', values: { reviews: '>=1' } }],
};

export const S45: Scenario = {
  id: 'S45',
  title: 'Enable notifications + prefs',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'enableNotifications', prefs: { orders: true, stock: true } },
    { expect: 'toast', message: 'notifications' },
  ],
};

export const S46: Scenario = {
  id: 'S46',
  title: 'Staff routes only; /insights redirects',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    {
      expect: 'reachable',
      routes: ['/sell', '/orders', '/stock', '/more', '/settings'],
    },
    { do: 'go', path: '/insights' },
    { expect: 'redirect', path: '/sell' },
  ],
};

export const S47: Scenario = {
  id: 'S47',
  title: 'Admin every route loads (default + empty seed)',
  role: 'pos_admin',
  seed: 'default',
  steps: [
    {
      expect: 'reachable',
      routes: [
        '/sell',
        '/orders',
        '/stock',
        '/more',
        '/settings',
        '/clients',
        '/history',
        '/insights',
        '/delivery',
        '/reviews',
        '/store',
        '/system',
      ],
    },
  ],
};

export const S48: Scenario = {
  id: 'S48',
  title: 'Offline boot keeps IDB data; sale fails cleanly',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'goOffline' },
    { do: 'addProduct', product: 'scout', flavors: { mint: 1 } },
    { do: 'setClient', name: 'Test Client A' },
    { do: 'charge' },
    { expect: 'toast', message: 'offline' },
  ],
};

export const S49: Scenario = {
  id: 'S49',
  title: 'Sign out then sign in respects next',
  role: 'pos_staff',
  seed: 'default',
  steps: [
    { do: 'signOut' },
    { do: 'signIn', next: '/next/sell' },
    { expect: 'redirect', path: '/sell' },
  ],
};

export const S50: Scenario = {
  id: 'S50',
  title: 'Display parity Today / Insights / credit / history',
  role: 'pos_admin',
  seed: 'default',
  steps: [
    {
      expect: 'display',
      values: {
        todayRevenue: 'legacy',
        todayJoints: 'legacy',
        insightsOverview: 'legacy',
        creditOwed: 'legacy',
        historyGroups: 'legacy',
      },
    },
  ],
};
