import { env, json } from './_shared/push.mjs';
import { adminHeaders, requireStaffUser, supabaseConfig } from './_shared/supabase-admin.mjs';

/**
 * Single authoritative inventory API for Venus POS.
 * Uses the service role so RLS cannot return empty ghosts or block writes.
 *
 * Body:
 *   { category_id, op: 'set', stock: number }
 *   { category_id, op: 'delta', delta: number }
 *   { op: 'ensure' | 'list' }  — absorb legacy `cookie`, create missing rows, return all stock
 *
 * Response: { ok: true, category_id, stock } or { ok: true, rows: [...] }
 */

const ALLOWED = new Set([
  'mint',
  'strawberry',
  'blueberry',
  'watermelon',
  'grape',
  'coconut',
  'melon',
  'classic',
  'spliff5050',
  'spliff7030',
  'cookie_butterscotch',
  'cookie_chocolate',
  'cookie_mint',
  'cookie_strawberry',
]);

const LEGACY_COOKIE = 'cookie';
const COOKIE_BUTTERSCOTCH = 'cookie_butterscotch';

function clampStock(n) {
  return Math.max(0, Math.floor(Number(n) || 0));
}

function canonicalCategoryId(categoryId) {
  const id = String(categoryId || '').trim();
  return id === LEGACY_COOKIE ? COOKIE_BUTTERSCOTCH : id;
}

async function restJson(url, serviceKey, path, { method = 'GET', body, prefer } = {}) {
  const extra = {};
  if (prefer) extra.Prefer = prefer;
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: adminHeaders(serviceKey, extra),
    ...(body != null ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text().catch(() => '');
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { ok: res.ok, status: res.status, data, text };
}

async function readRows(url, serviceKey, ids) {
  const filter = ids.map(encodeURIComponent).join(',');
  const { ok, status, data } = await restJson(
    url,
    serviceKey,
    `inventory?category_id=in.(${filter})&select=category_id,stock`,
  );
  if (!ok || !Array.isArray(data)) {
    throw new Error(`Read failed (${status})`);
  }
  return data;
}

async function upsertStock(url, serviceKey, categoryId, stock) {
  const payload = { stock: clampStock(stock), updated_at: new Date().toISOString() };
  const patch = await restJson(
    url,
    serviceKey,
    `inventory?category_id=eq.${encodeURIComponent(categoryId)}`,
    { method: 'PATCH', body: payload, prefer: 'return=representation' },
  );
  if (patch.ok && Array.isArray(patch.data) && patch.data.length > 0) {
    return clampStock(patch.data[0].stock);
  }

  const ins = await restJson(url, serviceKey, 'inventory', {
    method: 'POST',
    body: { category_id: categoryId, ...payload },
    prefer: 'return=representation',
  });
  if (ins.ok && Array.isArray(ins.data) && ins.data[0]) {
    return clampStock(ins.data[0].stock);
  }

  if (ins.status === 409) {
    const retry = await restJson(
      url,
      serviceKey,
      `inventory?category_id=eq.${encodeURIComponent(categoryId)}`,
      { method: 'PATCH', body: payload, prefer: 'return=representation' },
    );
    if (retry.ok && Array.isArray(retry.data) && retry.data.length > 0) {
      return clampStock(retry.data[0].stock);
    }
  }

  throw new Error(`Write failed (${patch.status}/${ins.status})`);
}

/**
 * Apply a stock delta with short retry.
 * Re-reads current stock each attempt — no fragile updated_at equality filters
 * (PostgREST timestamp eq mismatches were aborting every write).
 */
async function applyDelta(url, serviceKey, categoryId, delta, maxAttempts = 4) {
  const d = Math.trunc(Number(delta) || 0);
  if (d === 0) {
    const rows = await readRows(url, serviceKey, [categoryId]);
    return rows[0] ? clampStock(rows[0].stock) : 0;
  }

  let lastErr = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const rows = await readRows(url, serviceKey, [categoryId]);
      const current = rows[0] ? clampStock(rows[0].stock) : 0;
      return await upsertStock(url, serviceKey, categoryId, current + d);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Delta write failed');
}

/**
 * Move leftover shared `cookie` stock onto butterscotch, then zero the legacy row.
 * Copy only when butterscotch is empty — never add on top (retries would double).
 * Write butterscotch first so a failed second step cannot wipe stock.
 */
async function absorbLegacyCookie(url, serviceKey) {
  const rows = await readRows(url, serviceKey, [LEGACY_COOKIE, COOKIE_BUTTERSCOTCH]);
  const byId = Object.fromEntries(rows.map((r) => [r.category_id, clampStock(r.stock)]));
  const leftover = byId[LEGACY_COOKIE] || 0;
  const butter = byId[COOKIE_BUTTERSCOTCH] || 0;
  if (leftover <= 0) return butter;

  if (butter <= 0) {
    await upsertStock(url, serviceKey, COOKIE_BUTTERSCOTCH, leftover);
    await upsertStock(url, serviceKey, LEGACY_COOKIE, 0);
    return leftover;
  }
  return butter;
}

async function ensureRows(url, serviceKey) {
  await absorbLegacyCookie(url, serviceKey);
  const ids = [...ALLOWED];
  const rows = await readRows(url, serviceKey, [...ids, LEGACY_COOKIE]);
  const byId = Object.fromEntries(rows.map((r) => [r.category_id, clampStock(r.stock)]));
  const missing = ids.filter((id) => !Object.hasOwn(byId, id));
  if (missing.length) {
    const now = new Date().toISOString();
    const ins = await restJson(url, serviceKey, 'inventory', {
      method: 'POST',
      body: missing.map((category_id) => ({ category_id, stock: 0, updated_at: now })),
      prefer: 'return=representation',
    });
    if (!ins.ok) {
      throw new Error(`Ensure insert failed (${ins.status})`);
    }
    if (Array.isArray(ins.data)) {
      ins.data.forEach((row) => {
        byId[row.category_id] = clampStock(row.stock);
      });
    } else {
      missing.forEach((id) => {
        byId[id] = 0;
      });
    }
  }
  return ids.map((category_id) => ({
    category_id,
    stock: byId[category_id] || 0,
  }));
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const { url, serviceKey, anonKey } = supabaseConfig();
  if (!serviceKey) {
    return json({ error: 'Server inventory write not configured (missing service role)' }, 503);
  }

  const user = await requireStaffUser(req, { url, anonKey });
  if (!user) return json({ error: 'Unauthorized' }, 401);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const op = String(body?.op || 'set').toLowerCase();

  try {
    if (op === 'ensure' || op === 'list') {
      const rows = await ensureRows(url, serviceKey);
      return json({ ok: true, rows });
    }

    const categoryId = canonicalCategoryId(body?.category_id);
    if (!ALLOWED.has(categoryId)) {
      return json({ error: `Unknown category: ${categoryId}` }, 400);
    }

    // Any cookie write first folds leftover shared stock into butterscotch.
    if (categoryId.startsWith('cookie_')) {
      await absorbLegacyCookie(url, serviceKey);
    }

    let stock;
    if (op === 'delta') {
      stock = await applyDelta(url, serviceKey, categoryId, body?.delta);
    } else if (op === 'set') {
      stock = await upsertStock(url, serviceKey, categoryId, clampStock(body?.stock));
    } else {
      return json({ error: `Unknown op: ${op}` }, 400);
    }
    return json({ ok: true, category_id: categoryId, stock });
  } catch (err) {
    console.error('inventory-write', err);
    return json({ error: err?.message || 'Write failed' }, 500);
  }
};

export const config = {
  path: '/api/inventory/write',
  method: ['POST', 'OPTIONS'],
};
