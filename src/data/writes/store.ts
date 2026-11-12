import { sbFetch } from '../api';

export const FULFILLMENT_PATCH_PATH = 'store_fulfillment?id=eq.default';

export function patchFulfillment(body: Record<string, unknown>) {
  return sbFetch(FULFILLMENT_PATCH_PATH, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function storeAccountPath(id: string) {
  return `store_accounts?id=eq.${encodeURIComponent(id)}`;
}

export function patchStoreAccount(id: string, body: Record<string, unknown>) {
  return sbFetch(storeAccountPath(id), {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function deleteStoreAccount(id: string) {
  return sbFetch(storeAccountPath(id), { method: 'DELETE' });
}
