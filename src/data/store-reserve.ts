import { getAccessToken, peekAccessToken } from './auth';

export type ReserveResult = {
  ok: boolean;
  unsupported?: boolean;
  network?: boolean;
  consumed?: boolean;
  released?: boolean;
  reserved?: boolean;
  reason?: string;
  error?: string;
  message?: string;
  claimed?: Record<string, number>;
  status: number;
};

/** Staff call to /api/store-order/reserve. 404/405 means the function is not deployed yet. */
export async function postStoreReserve(body: Record<string, unknown>): Promise<ReserveResult> {
  const token = (await getAccessToken().catch(() => '')) || peekAccessToken();
  let res: Response;
  try {
    res = await fetch('/api/store-order/reserve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return {
      ok: false,
      network: true,
      error: e instanceof Error ? e.message : 'network',
      status: 0,
    };
  }
  if (res.status === 404 || res.status === 405) {
    return { ok: false, unsupported: true, status: res.status };
  }
  const data = (await res.json().catch(() => ({}))) as ReserveResult;
  return {
    ...data,
    status: res.status,
    ok: res.ok && data.ok !== false,
  };
}
