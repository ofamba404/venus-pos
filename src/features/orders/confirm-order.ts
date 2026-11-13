import { storeOrders, type StoreOrderRow } from '../../data/entities';
import { patchStoreOrder } from '../../data/writes/store-orders';
import { showToast } from '../../ui/ToastHost';

/**
 * A store order counts as confirmed once the store was told: status 'confirmed' or a confirmed_at stamp.
 * An order an earlier build marked 'accepted' was confirmed too, so it reads Confirmed.
 */
export function isOrderConfirmed(order?: Pick<StoreOrderRow, 'status' | 'confirmed_at'> | null): boolean {
  if (!order) return false;
  return order.status === 'confirmed' || order.status === 'accepted' || Boolean(order.confirmed_at);
}

/**
 * The one place an order gets confirmed. The Orders card and the order sheet both call it, so the write is
 * the same: status 'confirmed' plus confirmed_at. Resolves true on success. A failure toasts and leaves the order as it was.
 */
export async function confirmStoreOrder(id: string): Promise<boolean> {
  if (!id) return false;
  const confirmedAt = new Date().toISOString();
  let ok = false;
  try {
    const res = await patchStoreOrder(id, { status: 'confirmed', confirmed_at: confirmedAt });
    ok = res.ok;
  } catch {
    ok = false;
  }
  if (!ok) {
    showToast('Could not confirm order');
    return false;
  }
  storeOrders.value = storeOrders.value.map((row) =>
    row.id === id ? { ...row, status: 'confirmed', confirmed_at: confirmedAt } : row,
  );
  showToast('Order confirmed');
  return true;
}
