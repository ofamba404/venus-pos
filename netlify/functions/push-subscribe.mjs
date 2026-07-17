import { getStore } from '@netlify/blobs';
import { subscriptionKey } from './_shared/reminders.mjs';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const sub = body?.subscription;
  const endpoint = sub?.endpoint;
  const keys = sub?.keys;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return json({ error: 'Missing subscription' }, 400);
  }

  const schedulesEnabled = body.schedulesEnabled !== false;
  const store = getStore({ name: 'venus-push', consistency: 'strong' });
  const key = subscriptionKey(endpoint);

  await store.setJSON(key, {
    endpoint,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
    schedulesEnabled,
    userAgent: req.headers.get('user-agent') || '',
    updatedAt: new Date().toISOString(),
  });

  return json({ ok: true, key });
};

export const config = {
  path: '/api/push/subscribe',
  method: ['POST', 'OPTIONS'],
};
