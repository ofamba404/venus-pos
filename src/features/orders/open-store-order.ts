import { signal } from '@preact/signals';

/** The store order whose sheet is open, or empty. Shared so the success sheet can open the next one. */
export const openStoreOrderId = signal('');

export function openStoreOrder(id: string) {
  openStoreOrderId.value = id;
}

export function closeStoreOrder() {
  openStoreOrderId.value = '';
}
