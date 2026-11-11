/**
 * POS-only display names for storefront accounts.
 * Prefer pos_display_name over snapchat_name / order.customer_name in staff UI.
 * Does not change login identity.
 */

import { SUPABASE_ANON_JWT, SUPABASE_URL } from './config.js';

const STORE_AUTH_URL = `${SUPABASE_URL}/functions/v1/store-auth`;

/** @type {Map<string, string>} account id → label */
const byAccountId = new Map();
/** @type {Map<string, string>} lowercased snapchat_name → label */
const bySnapchat = new Map();

let loadPromise = null;
let loadedAt = 0;
const STALE_MS = 5 * 60_000;

function setLabel(id, snapchatName, posDisplayName) {
  const snap = String(snapchatName || '').trim();
  const alias = String(posDisplayName || '').trim();
  const label = alias || snap;
  if (id) {
    if (label) byAccountId.set(String(id), label);
    else byAccountId.delete(String(id));
  }
  if (snap) {
    const key = snap.toLowerCase();
    if (alias) bySnapchat.set(key, alias);
    else bySnapchat.delete(key);
  }
}

/**
 * @param {{ id?: string, snapchat_name?: string, pos_display_name?: string | null }[]} rows
 */
export function applyPosLabels(rows) {
  for (const row of rows || []) {
    if (!row) continue;
    setLabel(row.id, row.snapchat_name, row.pos_display_name);
  }
  loadedAt = Date.now();
}

export function upsertPosLabel(id, snapchatName, posDisplayName) {
  setLabel(id, snapchatName, posDisplayName);
  loadedAt = Date.now();
}

export async function ensurePosLabels({ force = false } = {}) {
  if (!force && loadPromise) return loadPromise;
  if (!force && loadedAt && Date.now() - loadedAt < STALE_MS) return;

  loadPromise = (async () => {
    try {
      const res = await fetch(STORE_AUTH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_JWT,
          Authorization: `Bearer ${SUPABASE_ANON_JWT}`,
        },
        body: JSON.stringify({ action: 'admin_list_pos_labels' }),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Labels failed (${res.status})`);
      byAccountId.clear();
      bySnapchat.clear();
      applyPosLabels(Array.isArray(data.labels) ? data.labels : []);
    } catch (err) {
      console.warn('pos labels load failed', err);
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

/**
 * Resolve the staff-facing name for a storefront order / account.
 * @param {{ account_id?: string, customer_name?: string, snapchat_name?: string, pos_display_name?: string | null } | null | undefined} source
 * @param {string} [fallback]
 */
export function posCustomerLabel(source, fallback = 'Customer') {
  if (!source) return fallback;
  const direct = String(source.pos_display_name || '').trim();
  if (direct) return direct;

  const accountId = source.account_id ? String(source.account_id) : '';
  if (accountId && byAccountId.has(accountId)) {
    return byAccountId.get(accountId) || fallback;
  }

  const snap = String(source.customer_name || source.snapchat_name || '').trim();
  if (snap) {
    const alias = bySnapchat.get(snap.toLowerCase());
    if (alias) return alias;
    return snap;
  }

  return fallback;
}
