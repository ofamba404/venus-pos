import { peekAccessToken } from '../auth';

export type ServerSettle = { qty: number; batches: number[] };

function authHeaders() {
  return {
    Authorization: `Bearer ${peekAccessToken()}`,
  };
}

/** GET the blob the register shares with v1. Null when the server does not answer. */
export async function fetchCookiePartnerSettle(): Promise<ServerSettle | null> {
  const res = await fetch('/api/cookie-partner/settle', { headers: authHeaders() });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as {
    ok?: boolean;
    settled_qty?: number;
    batches?: unknown;
  } | null;
  if (!data || data.ok === false || data.settled_qty == null) return null;
  const batches = Array.isArray(data.batches)
    ? data.batches.map((n) => Math.floor(Number(n) || 0)).filter((n) => n > 0)
    : [];
  return { qty: Math.max(0, Math.floor(Number(data.settled_qty) || 0)), batches };
}

/**
 * POST a higher total only. The caller must not paint a batch as settled
 * until this response is ok and the returned qty is at least the one we sent.
 */
export function postCookiePartnerSettle(settledQty: number, batches: number[], qtyBefore: number) {
  return fetch('/api/cookie-partner/settle', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ settled_qty: settledQty, batches, qty_before: qtyBefore }),
  });
}
