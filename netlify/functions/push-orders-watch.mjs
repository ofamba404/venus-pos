import { getStore } from '@netlify/blobs';
import { env, json, sendToAllStaff } from './_shared/push.mjs';

/**
 * Backup poller — catches new pending storefront orders even if the shopper's
 * browser failed to call /api/push/notify. Runs every minute in production.
 *
 * Dedupes by order id in Netlify Blobs so staff aren't spammed.
 */

const LOOKBACK_MS = 10 * 60_000;
const ALERT_STORE = 'venus-push-order-alerts';

function supabaseConfig() {
  const url = (env('SUPABASE_URL') || 'https://xiangrykfxlnacthjcad.supabase.co').replace(
    /\/$/,
    '',
  );
  // Service role bypasses RLS — required for the closed-browser backup poller.
  // Fall back to anon only for local dry-runs (will see 0 rows under RLS).
  const key =
    env('SUPABASE_SERVICE_ROLE_KEY') ||
    env('SUPABASE_SERVICE_KEY') ||
    env('SUPABASE_ANON_KEY') ||
    env('SUPABASE_KEY') ||
    env('SUPABASE_PUBLISHABLE_KEY') ||
    '';
  return { url, key, privileged: Boolean(env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SERVICE_KEY')) };
}

function alertStore() {
  return getStore({ name: ALERT_STORE, consistency: 'strong' });
}

async function fetchRecentPending() {
  const { url, key, privileged } = supabaseConfig();
  if (!key) throw new Error('Missing Supabase key for push-orders-watch');
  if (!privileged) {
    console.warn(
      'push-orders-watch: set SUPABASE_SERVICE_ROLE_KEY on Netlify for backup order alerts (anon cannot read store_orders under RLS)',
    );
  }
  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
  const path = `${url}/rest/v1/store_orders?select=id,customer_name,item_count,subtotal_ugx,created_at,status&status=eq.pending&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=20`;
  const res = await fetch(path, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`store_orders ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

function formatBody(row) {
  const name = String(row.customer_name || '').trim() || 'A customer';
  const parts = [name];
  const n = Number(row.item_count) || 0;
  if (n) parts.push(`${n} item${n === 1 ? '' : 's'}`);
  const sub = Number(row.subtotal_ugx) || 0;
  if (sub > 0) parts.push(`UGX ${sub.toLocaleString('en-US')}`);
  return parts.join(' · ');
}

export default async () => {
  let rows;
  try {
    rows = await fetchRecentPending();
  } catch (err) {
    console.error('push-orders-watch fetch failed', err);
    return json({ ok: false, error: String(err?.message || err) }, 500);
  }

  if (!rows.length) return json({ ok: true, checked: 0, pushed: 0 });

  const store = alertStore();
  let pushed = 0;
  let skipped = 0;
  const results = [];

  for (const row of rows) {
    if (!row?.id) continue;
    const key = `order:${row.id}`;
    const existing = await store.get(key, { type: 'json' }).catch(() => null);
    if (existing?.pushedAt) {
      skipped += 1;
      continue;
    }

    const send = await sendToAllStaff({
      type: 'storefront-order',
      title: 'Order placed',
      body: formatBody(row),
      url: '/#store-orders',
      tag: `storefront-order-${row.id}`,
      requireInteraction: true,
    });

    await store.setJSON(key, {
      orderId: row.id,
      pushedAt: new Date().toISOString(),
      sent: send.sent || 0,
    });

    pushed += 1;
    results.push({ id: row.id, ...send });
  }

  return json({ ok: true, checked: rows.length, pushed, skipped, results });
};

export const config = {
  schedule: '* * * * *',
};
