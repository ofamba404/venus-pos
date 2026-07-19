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
      'Access-Control-Allow-Headers': 'Content-Type, X-Venus-Push-Secret',
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
 * }} payload
 * schedulesOnly: only devices with schedulesEnabled (quote reminders).
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
    requireInteraction: Boolean(payload.requireInteraction),
  });

  let sent = 0;
  let gone = 0;
  let errors = 0;
  let skipped = 0;

  for (const { key } of blobs) {
    const record = await store.get(key, { type: 'json' });
    if (!record?.endpoint || !record?.keys) continue;

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
        { TTL: 60 * 60 * 12, urgency: 'high' },
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
