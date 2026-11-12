import { sbFetch } from '../api';

export function storeOrderPatchPath(id: string) {
  return `store_orders?id=eq.${encodeURIComponent(id)}`;
}

export function storeOrderCheckedOutBody(saleId: string) {
  return { status: 'checked_out', sale_id: saleId };
}

export function patchStoreOrder(id: string, body: Record<string, unknown>) {
  return sbFetch(storeOrderPatchPath(id), {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}
