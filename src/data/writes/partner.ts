import { getAccessToken, peekAccessToken, refreshNow } from '../auth';

export type ServerSettle = { qty: number; batches: number[] };

function authHeaders(token = peekAccessToken()) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

/**
 * The function answers 401 to an expired token, and the page used to read that as "no settlement" and show no
 * batches. Refresh the token first, and once more if the server still says 401.
 */
async function settleFetch(init: RequestInit): Promise<Response> {
  const token = (await getAccessToken().catch(() => '')) || peekAccessToken();
  const exec = (t: string) =>
    fetch('/api/cookie-partner/settle', {
      ...init,
      cache: 'no-store',
      headers: { ...(init.headers || {}), ...authHeaders(t) },
    });
  let res = await exec(token);
  if (res.status === 401) {
    const next = await refreshNow().catch(() => null);
    if (next?.access_token) res = await exec(next.access_token);
  }
  return res;
}

/** GET the blob the register shares with v1. Null when the server does not answer. */
export async function fetchCookiePartnerSettle(): Promise<ServerSettle | null> {
  const res = await settleFetch({});
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
  return settleFetch({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ settled_qty: settledQty, batches, qty_before: qtyBefore }),
  });
}
