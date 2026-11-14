import { postStoreReserve } from '../../data/store-reserve';
import { ensureInventory, loadStoreOrders } from '../../data/entities';
import { patchStoreOrder } from '../../data/writes/store-orders';

export async function cancelStoreOrder(orderId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await postStoreReserve({ op: 'release', id: orderId, cancel: true });
  if (result.unsupported) {
    const res = await patchStoreOrder(orderId, {
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
    });
    if (!res.ok) return { ok: false, error: 'Could not cancel order' };
  } else if (!result.ok) {
    return { ok: false, error: result.message || result.error || 'Could not cancel order' };
  }
  await Promise.allSettled([loadStoreOrders(), ensureInventory()]);
  return { ok: true };
}
