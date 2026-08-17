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
 */

const CATEGORY_META = {
  mint: { display_name: 'Mint', category_sub: '', color: '#8fd6f0' },
  strawberry: { display_name: 'Strawberry', category_sub: '', color: '#d81e2c' },
  blueberry: { display_name: 'Blueberry', category_sub: '', color: '#3f5bb8' },
  watermelon: { display_name: 'Watermelon', category_sub: '', color: '#f4a6c1' },
  grape: { display_name: 'Grape', category_sub: '', color: '#D5C7E8' },
  coconut: { display_name: 'Coconut', category_sub: '', color: '#ffffff' },
  melon: { display_name: 'Melon', category_sub: '', color: '#ff8c1a' },
  classic: { display_name: 'Plain', category_sub: '', color: '#e3cba7' },
  spliff5050: { display_name: 'Bangis', category_sub: '50/50', color: '#ffd400' },
  spliff7030: { display_name: 'Bangis', category_sub: '70/30', color: '#FFFFA5' },
  cookie_butterscotch: { display_name: 'Butterscotch', category_sub: 'Cookie', color: '#D4A355' },
  cookie_chocolate: { display_name: 'Chocolate', category_sub: 'Cookie', color: '#5c2e1f' },
  cookie_mint: { display_name: 'Mint', category_sub: 'Cookie', color: '#3CB043' },
  cookie_strawberry: { display_name: 'Strawberry', category_sub: 'Cookie', color: '#d81e2c' },
  // Legacy shared cookie row — kept only so absorption can zero it.
  cookie: { display_name: 'Cookies', category_sub: '', color: '#d4af37' },
};

const ALLOWED = new Set(Object.keys(CATEGORY_META).filter((id) => id !== 'cookie'));

const LEGACY_COOKIE = 'cookie';
const COOKIE_BUTTERSCOTCH = 'cookie_butterscotch';

function clampStock(n) {
  return Math.max(0, Math.floor(Number(n) || 0));
}

function canonicalCategoryId(categoryId) {
  const id = String(categoryId || '').trim();
  return id === LEGACY_COOKIE ? COOKIE_BUTTERSCOTCH : id;
}

function rowPayload(categoryId, stock) {
  const meta = CATEGORY_META[categoryId] || {
    display_name: categoryId,
    category_sub: '',
    color: '#888888',
  };
  return {
    category_id: categoryId,
    display_name: meta.display_name,
    category_sub: meta.category_sub,
    color: meta.color,
    stock: clampStock(stock),
    updated_at: new Date().toISOString(),
  };
}

function requestMethod(req) {
  const raw =
    (req && typeof req.method === 'string' && req.method) ||
    (req && typeof req.httpMethod === 'string' && req.httpMethod) ||
    '';
  return String(raw || 'POST').toUpperCase();
}

async function readJsonBody(req) {
  if (typeof req?.json === 'function') {
    try {
      return await req.json();
    } catch {
      return null;
    }
  }
  if (req?.body == null) return null;
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(String(req.body));
  } catch {
    return null;
  }
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
    throw new Error(`Read failed (${status}) ${typeof data === 'string' ? data : ''}`);
  }
  return data;
}

async function upsertStock(url, serviceKey, categoryId, stock) {
  const payload = rowPayload(categoryId, stock);
  const patchBody = {
    display_name: payload.display_name,
    category_sub: payload.category_sub,
    color: payload.color,
    stock: payload.stock,
    updated_at: payload.updated_at,
  };

  const patch = await restJson(
    url,
    serviceKey,
    `inventory?category_id=eq.${encodeURIComponent(categoryId)}`,
    { method: 'PATCH', body: patchBody, prefer: 'return=representation' },
  );
  if (patch.ok && Array.isArray(patch.data) && patch.data.length > 0) {
    return clampStock(patch.data[0].stock);
  }

  const ins = await restJson(url, serviceKey, 'inventory', {
    method: 'POST',
    body: payload,
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
      { method: 'PATCH', body: patchBody, prefer: 'return=representation' },
    );
    if (retry.ok && Array.isArray(retry.data) && retry.data.length > 0) {
      return clampStock(retry.data[0].stock);
    }
    throw new Error(`Write conflict (${retry.status}) ${retry.text || ''}`);
  }

  throw new Error(`Write failed (${patch.status}/${ins.status}) ${ins.text || patch.text || ''}`);
}

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

async function absorbLegacyCookie(url, serviceKey) {
  const rows = await readRows(url, serviceKey, [LEGACY_COOKIE, COOKIE_BUTTERSCOTCH]);
  const byId = Object.fromEntries(rows.map((r) => [r.category_id, clampStock(r.stock)]));
  const leftover = byId[LEGACY_COOKIE] || 0;
  const butter = byId[COOKIE_BUTTERSCOTCH] || 0;
  if (leftover <= 0) return butter;

  // Prefer keeping an existing butterscotch count; only copy when missing/empty.
  if (butter <= 0) {
    await upsertStock(url, serviceKey, COOKIE_BUTTERSCOTCH, leftover);
    await upsertStock(url, serviceKey, LEGACY_COOKIE, 0);
    return leftover;
  }
  // Butterscotch already has stock — just clear the legacy bucket so it stops double-counting.
  await upsertStock(url, serviceKey, LEGACY_COOKIE, 0);
  return butter;
}

async function ensureRows(url, serviceKey) {
  await absorbLegacyCookie(url, serviceKey);
  const ids = [...ALLOWED];
  const rows = await readRows(url, serviceKey, [...ids, LEGACY_COOKIE]);
  const byId = Object.fromEntries(rows.map((r) => [r.category_id, clampStock(r.stock)]));
  const missing = ids.filter((id) => !Object.hasOwn(byId, id));
  for (const id of missing) {
    byId[id] = await upsertStock(url, serviceKey, id, 0);
  }
  return ids.map((category_id) => ({
    category_id,
    stock: byId[category_id] || 0,
  }));
}

export default async (req) => {
  const method = requestMethod(req);
  if (method === 'OPTIONS' || method === 'HEAD') return json({ ok: true });
  if (method === 'GET' || method === 'DELETE' || method === 'PUT' || method === 'PATCH') {
    return json({ error: `Method not allowed (${method})`, method }, 405);
  }

  const { url, serviceKey, anonKey } = supabaseConfig();
  if (!serviceKey) {
    return json({ error: 'Server inventory write not configured (missing service role)' }, 503);
  }

  const user = await requireStaffUser(req, { url, anonKey });
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const body = await readJsonBody(req);
  if (!body || typeof body !== 'object') {
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
};
