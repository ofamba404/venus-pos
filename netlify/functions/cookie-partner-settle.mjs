import { getStore } from '@netlify/blobs';
import { normalizeSettledBatches } from '../../js/cookie-partner-batches.js';
import { auditEntry, clampQty, mergeSettleWrite } from './_shared/cookie-settle-merge.mjs';
import { json } from './_shared/push.mjs';
import { requireStaffUser, supabaseConfig } from './_shared/supabase-admin.mjs';

const BLOB_STORE = 'venus-cookie-partner';
/** v4 — plain integer string. Do not change this value's format. */
const BLOB_KEY = 'settled-qty-v4';
/** Optional send sizes that sum to settled qty. Ignored when they do not match. */
const BATCHES_KEY = 'settled-batches-v1';
/** Append-only list of sends: [{ at, qty_before, qty_after, batch_size, by }]. */
const AUDIT_KEY = 'send-audit-v1';
/**
 * First 25-cookie batch (~136k) already paid. Seed when this key is empty.
 */
const BOOTSTRAP_SETTLED_QTY = 25;

function settleStore() {
  return getStore({ name: BLOB_STORE, consistency: 'strong' });
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

/** `strict`: let a storage error throw so a write never merges against "no cuts" by mistake. */
async function readBatches({ strict = false } = {}) {
  try {
    const raw = await settleStore().get(BATCHES_KEY, { type: 'text' });
    if (raw == null || raw === '') return null;
    return JSON.parse(raw);
  } catch (err) {
    if (strict) throw err;
    return null;
  }
}

async function writeBatches(batches) {
  await settleStore().set(BATCHES_KEY, JSON.stringify(batches));
}

async function appendAudit(entry) {
  try {
    const store = settleStore();
    let list = [];
    try {
      const raw = await store.get(AUDIT_KEY, { type: 'text' });
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      /* start a fresh list rather than lose the entry */
    }
    list.push(entry);
    await store.set(AUDIT_KEY, JSON.stringify(list));
  } catch (err) {
    console.error('cookie-partner-settle audit', err);
  }
}

function batchesForQty(raw, qty) {
  if (qty == null) return null;
  return normalizeSettledBatches(raw, qty);
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
      const batches = batchesForQty(await readBatches(), settled_qty);
      return json({ ok: true, settled_qty, batches });
    }

    if (method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const body = await readJsonBody(req);
    if (body?.settled_qty == null && body?.qty == null) {
      return json({ error: 'Missing settled_qty' }, 400);
    }
    // Read the stored state directly (a failed read must not look like qty 0).
    const current = await readSettledQty();
    if (current == null) return json({ error: 'Settle state unavailable' }, 503);
    const merged = mergeSettleWrite({
      currentQty: current,
      currentBatches: await readBatches({ strict: true }),
      bodyQty: body.settled_qty ?? body.qty,
      bodyBatches: body.batches,
    });
    if (!merged.ok) return json({ error: merged.error || 'Invalid batches' }, 400);
    if (merged.writeBatches && merged.batches) await writeBatches(merged.batches);
    if (merged.applied) {
      await writeSettledQty(merged.qty);
      await appendAudit(
        auditEntry({
          qtyBefore: merged.qtyBefore,
          qtyAfter: merged.qty,
          batchSize: merged.batchSize,
          by: user.id || null,
        }),
      );
    } else if (clampQty(body.settled_qty ?? body.qty) < current) {
      console.warn('cookie-partner-settle: refused to lower settled qty', {
        stored: current,
        attempted: clampQty(body.settled_qty ?? body.qty),
        by: user.id || null,
      });
    }
    return json({
      ok: true,
      applied: merged.applied,
      settled_qty: merged.qty,
      batches: batchesForQty(merged.batches, merged.qty),
      updated_by: user.id || null,
    });
  } catch (err) {
    console.error('cookie-partner-settle', err);
    return json({ error: err?.message || 'Settle sync failed' }, 500);
  }
};

export const config = {
  path: '/api/cookie-partner/settle',
  method: ['GET', 'POST', 'OPTIONS'],
};
