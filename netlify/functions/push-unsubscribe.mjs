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

  const endpoint = body?.endpoint || body?.subscription?.endpoint;
  if (!endpoint) return json({ error: 'Missing endpoint' }, 400);

  const store = getStore({ name: 'venus-push', consistency: 'strong' });
  const key = subscriptionKey(endpoint);
  const existing = await store.get(key, { type: 'json' });
  if (!existing) return json({ ok: true, missing: true });

  if (typeof body.schedulesEnabled === 'boolean') {
    await store.setJSON(key, {
      ...existing,
      schedulesEnabled: body.schedulesEnabled,
      updatedAt: new Date().toISOString(),
    });
    return json({ ok: true, schedulesEnabled: body.schedulesEnabled });
  }

  await store.delete(key);
  return json({ ok: true, deleted: true });
};

export const config = {
  path: '/api/push/unsubscribe',
  method: ['POST', 'OPTIONS'],
};
