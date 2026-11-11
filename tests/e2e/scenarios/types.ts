/** UI-agnostic scenario intents for legacy + next drivers. */

export type ScenarioStep =
  | { do: 'addProduct'; product: string; flavors?: Record<string, number>; qty?: number; unitPrice?: number }
  | { do: 'editLine'; key?: string; product: string; flavors?: Record<string, number>; qty?: number }
  | { do: 'removeLine'; key?: string; product?: string }
  | { do: 'undo' }
  | { do: 'setClient'; name: string; create?: boolean }
  | { do: 'setCredit'; value: boolean }
  | { do: 'confirmStackedDebt'; accept: boolean }
  | { do: 'setDelivery'; feeUgx?: number; feeEdited?: boolean; destText?: string; phone?: string; deliverAt?: string }
  | { do: 'charge' }
  | { do: 'chargeRetry' }
  | { do: 'doubleTapCharge' }
  | { do: 'loadStoreOrder'; id: string }
  | { do: 'confirmStoreOrder' }
  | { do: 'cancelStoreOrder'; id: string }
  | { do: 'dismissStoreOrder'; id: string }
  | { do: 'parkCounterCart' }
  | { do: 'restoreCounterCart' }
  | { do: 'setStoreBusy'; minutes: number | null }
  | { do: 'adjustStock'; categoryId: string; delta: number }
  | { do: 'setStockCount'; categoryId: string; qty: number }
  | { do: 'settleCredit'; clientId?: string; clientName?: string; amountUgx: number; method?: string; note?: string }
  | { do: 'editSale'; saleId: string }
  | { do: 'voidSale'; saleId: string }
  | { do: 'partnerSettleBatch' }
  | { do: 'clientsCrud'; action: 'add' | 'rename' | 'delete'; name?: string; newName?: string }
  | { do: 'storeUsers'; action: 'setName' | 'verify' | 'delete'; name?: string }
  | { do: 'setStoreHours'; open: string; close: string; suggest?: string }
  | { do: 'editDeliveryTrip'; id: string }
  | { do: 'quoteLabPreset' }
  | { do: 'refreshReviews' }
  | { do: 'enableNotifications'; prefs?: Record<string, boolean> }
  | { do: 'signOut' }
  | { do: 'signIn'; next?: string }
  | { do: 'go'; path: string }
  | { do: 'goOffline' }
  | { expect: 'saleRecorded'; total: number }
  | { expect: 'noWrites' }
  | { expect: 'toast'; message: string }
  | { expect: 'redirect'; path: string }
  | { expect: 'stock'; categoryId: string; qty: number }
  | { expect: 'display'; values: Record<string, number | string> }
  | { expect: 'reachable'; routes: string[] }
  | { expect: 'clipboard'; includes: string };

export type Scenario = {
  id: string;
  title: string;
  role: 'pos_admin' | 'pos_staff';
  seed: 'default' | 'empty';
  steps: ScenarioStep[];
};
