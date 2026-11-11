import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

function authBearer() {
  const token = window.VenusPosAuth?.peekAccessToken?.() || '';
  return token || SUPABASE_KEY;
}

export async function sbFetch(path, options = {}) {
  let bearer = authBearer();
  if (window.VenusPosAuth?.getAccessToken && bearer === SUPABASE_KEY) {
    try {
      const fresh = await window.VenusPosAuth.getAccessToken();
      if (fresh) bearer = fresh;
    } catch {
      /* fall through with publishable key — RLS will reject */
    }
  }

  const exec = (token) =>
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
  if (res.status === 401 && window.VenusPosAuth?.refreshNow) {
    const next = await window.VenusPosAuth.refreshNow().catch(() => null);
    if (next?.access_token && next.access_token !== bearer) {
      res = await exec(next.access_token);
    }
  }
  return res;
}

/** DELETE and verify at least one row was removed (PostgREST can return 204 with 0 rows under RLS). */
export async function sbDelete(path) {
  const res = await sbFetch(path, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Delete blocked — no rows removed');
  }
  return rows;
}
