import { configureWebPush, json, posUserFromRequest, pushStore, subscriptionKey } from './_shared/push.mjs';

/**
 * Send ONE test push to the caller's own device. Used by Settings, Notification check.
 *
 * Auth: a signed-in POS session. Body: { endpoint } (this browser's push endpoint).
 * It only ever sends to a stored subscription whose userId matches the caller, so it
 * cannot be used to ping other devices, and it never touches orders or sales.
 * Reports what the push service answered, so a failure names its cause.
 */
export default async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const user = await posUserFromRequest(req);
  if (!user) return json({ error: 'Sign in to the POS to test notifications' }, 401);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const endpoint = String(body?.endpoint || '');
  if (!endpoint) return json({ error: 'endpoint required' }, 400);

  const configured = configureWebPush();
  if (!configured.ok) return json({ ok: false, step: 'vapid', error: configured.error }, 500);

  const store = pushStore();
  const record = await store.get(subscriptionKey(endpoint), { type: 'json' }).catch(() => null);
  if (!record?.endpoint || !record?.keys || record.endpoint !== endpoint) {
    // The phone has a browser subscription the server never stored (or deleted after the push service called it gone).
    return json({ ok: false, step: 'stored', error: 'This phone is not registered on the server. Tap Enable notifications.' }, 404);
  }
  if (record.userId && record.userId !== user.id) {
    return json({ ok: false, step: 'owner', error: 'That subscription belongs to another account' }, 403);
  }

  const payload = JSON.stringify({
    type: 'test',
    title: 'Venus test',
    body: 'Notifications work on this phone.',
    url: '/next/settings',
    tag: 'venus-test',
    requireInteraction: false,
    vibrate: [220, 80, 220],
    renotify: true,
  });

  try {
    await configured.webpush.sendNotification({ endpoint: record.endpoint, keys: record.keys }, payload, {
      TTL: 60,
      urgency: 'high',
    });
    return json({ ok: true, step: 'sent', pushService: new URL(record.endpoint).host });
  } catch (err) {
    const status = err?.statusCode || err?.status || 0;
    return json(
      {
        ok: false,
        step: 'push-service',
        status,
        pushService: new URL(record.endpoint).host,
        error:
          status === 404 || status === 410
            ? 'The phone dropped this subscription. Tap Enable notifications again.'
            : `The push service refused the message (${status || 'no response'})`,
      },
      502,
    );
  }
};

export const config = {
  path: '/api/push/test',
  method: ['POST', 'OPTIONS'],
};
