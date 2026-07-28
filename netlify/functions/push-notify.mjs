import { getStore } from '@netlify/blobs';
import { env, json, sendToAllStaff } from './_shared/push.mjs';

/**
 * Broadcast a push to all subscribed Venus POS devices.
 * Called from the storefront when a customer places an order (closed-browser delivery).
 *
 * Body: { type, title, body?, url?, tag?, requireInteraction? }
 *
 * Optional Netlify env `PUSH_NOTIFY_SECRET` — when set, require header
 * `X-Venus-Push-Secret`. Leave unset for open notify (small-shop default).
 */
export default async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const secret = env('PUSH_NOTIFY_SECRET');
  if (secret) {
    const provided = req.headers.get('x-venus-push-secret') || '';
    if (provided !== secret) return json({ error: 'Unauthorized' }, 401);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  if (!body?.title) {
    return json({ error: 'title required' }, 400);
  }

  const type = body.type || 'storefront-order';
  const tag = body.tag || `venus-pos-${Date.now()}`;

  const result = await sendToAllStaff({
    type,
    title: body.title,
    body: body.body || '',
    url: body.url || '/#store-orders',
    tag,
    requireInteraction: body.requireInteraction !== false,
  });

  // Mark order as alerted so the minute poller does not double-push.
  const orderMatch = String(tag).match(/^storefront-order-(.+)$/);
  if (orderMatch?.[1] && type === 'storefront-order') {
    try {
      const store = getStore({ name: 'venus-push-order-alerts', consistency: 'strong' });
      await store.setJSON(`order:${orderMatch[1]}`, {
        orderId: orderMatch[1],
        pushedAt: new Date().toISOString(),
        sent: result.sent || 0,
        via: 'notify',
      });
    } catch (err) {
      console.warn('order alert dedupe write failed', err);
    }
  }

  if (!result.ok && result.error) return json(result, 500);
  return json(result);
};

export const config = {
  path: '/api/push/notify',
  method: ['POST', 'OPTIONS'],
};
