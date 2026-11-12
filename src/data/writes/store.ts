import { peekAccessToken } from '../auth';
import { sbFetch } from '../api';
import { SUPABASE_ANON_JWT, SUPABASE_URL } from '../env';

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

/** Storefront admin action. The reset code is returned once and is not stored in the POS. */
export async function storeAuth(action: string, body: Record<string, unknown> = {}) {
  const token = peekAccessToken() || SUPABASE_ANON_JWT;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/store-auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_JWT,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, ...body }),
  });
  const data = (await res.json().catch(() => ({}))) as { code?: string; error?: string; expires_at?: string };
  return { ok: res.ok, data };
}
