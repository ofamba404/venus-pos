import { SUPABASE_URL, SUPABASE_KEY } from './env';
import { getAccessToken, peekAccessToken, refreshNow } from './auth';

export async function sbFetch(path: string, options: RequestInit = {}) {
  let bearer = peekAccessToken() || SUPABASE_KEY;
  if (bearer === SUPABASE_KEY) {
    const fresh = await getAccessToken().catch(() => '');
    if (fresh) bearer = fresh;
  }

  const exec = (token: string) =>
    fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...options,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

  let res = await exec(bearer);
  if (res.status === 401) {
    const next = await refreshNow().catch(() => null);
    if (next?.access_token && next.access_token !== bearer) {
      res = await exec(next.access_token);
    }
  }
  return res;
}

export async function functionFetch(path: string, body: unknown) {
  const token = (await getAccessToken()) || peekAccessToken();
  if (!token) throw new Error('Not signed in');
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data && data.ok === false)) {
    const err = new Error(data?.error || res.statusText || `HTTP ${res.status}`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  return data;
}
