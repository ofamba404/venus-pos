import { getStore } from '@netlify/blobs';
import { json } from './_shared/push.mjs';
import { requireStaffUser, supabaseConfig } from './_shared/supabase-admin.mjs';

const BLOB_STORE = 'venus-cookie-partner';
/** v4 — ignore corrupted v3 value that marked every cookie settled. */
const BLOB_KEY = 'settled-qty-v4';
/**
 * First 25-cookie batch (~136k) already paid. Seed when this key is empty.
 */
const BOOTSTRAP_SETTLED_QTY = 25;

function settleStore() {
  return getStore({ name: BLOB_STORE, consistency: 'strong' });
}

function clampQty(n) {
  return Math.max(0, Math.floor(Number(n) || 0));
}

async function readSettledQty() {
  try {
    const store = settleStore();
    const raw = await store.get(BLOB_KEY, { type: 'text' });
    if (raw == null || raw === '') {
      await store.set(BLOB_KEY, String(BOOTSTRAP_SETTLED_QTY));
      return BOOTSTRAP_SETTLED_QTY;
    }
    return clampQty(raw);
  } catch {
    return null;
  }
}

async function writeSettledQty(qty) {
  const n = clampQty(qty);
  await settleStore().set(BLOB_KEY, String(n));
  return n;
}

function requestMethod(req) {
  const raw =
    (req && typeof req.method === 'string' && req.method) ||
    (req && typeof req.httpMethod === 'string' && req.httpMethod) ||
    '';
  return String(raw || 'GET').toUpperCase();
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

export default async (req) => {
  const method = requestMethod(req);
  if (method === 'OPTIONS') return json({ ok: true });

  const { url, anonKey } = supabaseConfig();
  const user = await requireStaffUser(req, { url, anonKey });
  if (!user) return json({ error: 'Unauthorized' }, 401);

  try {
    if (method === 'GET') {
      const settled_qty = await readSettledQty();
      return json({ ok: true, settled_qty });
    }

    if (method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const body = await readJsonBody(req);
    if (body?.settled_qty == null && body?.qty == null) {
      return json({ error: 'Missing settled_qty' }, 400);
    }
    const next = clampQty(body.settled_qty ?? body.qty);
    const settled_qty = await writeSettledQty(next);
    return json({ ok: true, settled_qty, updated_by: user.id || null });
  } catch (err) {
    console.error('cookie-partner-settle', err);
    return json({ error: err?.message || 'Settle sync failed' }, 500);
  }
};

export const config = {
  path: '/api/cookie-partner/settle',
  method: ['GET', 'POST', 'OPTIONS'],
};
