import { getStore } from '@netlify/blobs';
import webpush from 'web-push';
import { subscriptionKey } from './reminders.mjs';

export function env(name) {
  try {
    if (typeof Netlify !== 'undefined' && Netlify.env?.get) {
      const v = Netlify.env.get(name);
      if (v) return v;
    }
  } catch {
    /* local / missing */
  }
  return process.env[name] || '';
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Venus-Push-Secret',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  });
}

export function pushStore() {
  return getStore({ name: 'venus-push', consistency: 'strong' });
}

export function configureWebPush() {
  const publicKey = env('VAPID_PUBLIC_KEY');
  const privateKey = env('VAPID_PRIVATE_KEY');
  const subject = env('VAPID_SUBJECT') || 'mailto:venus-pos@netlify.app';
  if (!publicKey || !privateKey) {
    return { ok: false, error: 'VAPID keys not configured' };
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return { ok: true, webpush };
}

/**
 * Broadcast a Web Push to all subscribed POS devices.
 * @param {{
 *   type?: string,
 *   title: string,
 *   body?: string,
 *   url?: string,
 *   tag?: string,
 *   requireInteraction?: boolean,
 *   schedulesOnly?: boolean,
 *   orderId?: string,
 * }} payload
 * schedulesOnly: only devices with schedulesEnabled (quote reminders).
 * audience: 'all' (every POS device) | 'admin' (pos_admin + admin-legacy only). Default 'admin'.
 */
export async function sendToAllStaff(payload) {
  const configured = configureWebPush();
  if (!configured.ok) return { ok: false, error: configured.error, sent: 0 };

  const store = pushStore();
  const { blobs } = await store.list();
  const body = JSON.stringify({
    type: payload.type || 'order',
    title: payload.title,
    body: payload.body || '',
    url: payload.url || '/',
    tag: payload.tag || `venus-pos-${Date.now()}`,
    requireInteraction: payload.requireInteraction !== false,
    vibrate: [220, 80, 220, 80, 400],
    renotify: true,
    ...(payload.orderId ? { orderId: String(payload.orderId) } : {}),
  });

  let sent = 0;
  let gone = 0;
  let errors = 0;
  let skipped = 0;

  for (const { key } of blobs) {
    const record = await store.get(key, { type: 'json' });
    if (!record?.endpoint || !record?.keys) continue;

    // Devices registered before sign-in was required have no role: treat as owner's.
    const role = record.role || 'admin-legacy';
    const isAdminDevice = role === 'pos_admin' || role === 'admin-legacy';
    const audience = payload.audience === 'all' ? 'all' : 'admin';
    if (audience === 'admin' && !isAdminDevice) {
      skipped += 1;
      continue;
    }
    if (role !== 'pos_admin' && role !== 'pos_staff' && role !== 'admin-legacy') {
      skipped += 1;
      continue;
    }

    if (payload.schedulesOnly) {
      if (record.schedulesEnabled === false) {
        skipped += 1;
        continue;
      }
    } else if (record.ordersEnabled === false) {
      skipped += 1;
      continue;
    }

    try {
      await configured.webpush.sendNotification(
        { endpoint: record.endpoint, keys: record.keys },
        body,
        {
          // Keep trying to deliver for a full day if the device was offline.
          TTL: 60 * 60 * 24,
          urgency: 'high',
        },
      );
      sent += 1;
    } catch (err) {
      const status = err?.statusCode || err?.status;
      if (status === 404 || status === 410) {
        await store.delete(key);
        gone += 1;
      } else {
        errors += 1;
        console.warn('push send failed', status, err?.message || err);
      }
    }
  }

  return { ok: true, sent, gone, errors, skipped };
}

export { subscriptionKey };

/** Validate a POS session JWT and return { id, role } or null. */
export async function posUserFromRequest(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  const url = (env('SUPABASE_URL') || 'https://xiangrykfxlnacthjcad.supabase.co').replace(/\/$/, '');
  const anonKey =
    env('SUPABASE_ANON_KEY') ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhpYW5ncnlrZnhsbmFjdGhqY2FkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxMjI2MDIsImV4cCI6MjA5ODY5ODYwMn0.O4IQo4aGqcSzWhE9H1szByvoblo07e7Pm3EL3v182b8';
  if (!token || token === anonKey) return null;
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!res?.ok) return null;
  const user = await res.json().catch(() => null);
  const role = user?.app_metadata?.role;
  if (!user?.id || (role !== 'pos_admin' && role !== 'pos_staff')) return null;
  return { id: user.id, role, email: user.email || '' };
}
