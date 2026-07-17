import { getStore } from '@netlify/blobs';
import webpush from 'web-push';
import { remindersDueNow } from './reminders.mjs';

function env(name) {
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
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** Send due Kampala reminder pushes to all enabled subscriptions. */
export async function sendDueReminders(date = new Date()) {
  const publicKey = env('VAPID_PUBLIC_KEY');
  const privateKey = env('VAPID_PRIVATE_KEY');
  const subject = env('VAPID_SUBJECT') || 'mailto:venus-pos@netlify.app';

  if (!publicKey || !privateKey) {
    return { ok: false, error: 'VAPID keys not configured', status: 500 };
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);

  const due = remindersDueNow(date, 8);
  if (!due.length) {
    return { ok: true, due: [], sent: 0, skipped: 0, gone: 0, errors: 0 };
  }

  const pushStore = getStore({ name: 'venus-push', consistency: 'strong' });
  const logStore = getStore({ name: 'venus-push-log', consistency: 'strong' });

  const { blobs } = await pushStore.list();
  const results = { ok: true, due: due.map((d) => d.id), sent: 0, skipped: 0, gone: 0, errors: 0 };

  for (const slot of due) {
    const logKey = `${slot.dateKey}:${slot.id}`;
    const already = await logStore.get(logKey);
    if (already) {
      results.skipped += 1;
      continue;
    }

    await logStore.set(logKey, new Date().toISOString());

    const payload = JSON.stringify({
      type: slot.type,
      title: slot.title,
      body: slot.body,
      url: slot.path,
      tag: slot.id,
    });

    for (const { key } of blobs) {
      const record = await pushStore.get(key, { type: 'json' });
      if (!record?.endpoint || !record?.keys) continue;
      if (record.schedulesEnabled === false) continue;

      try {
        await webpush.sendNotification(
          {
            endpoint: record.endpoint,
            keys: record.keys,
          },
          payload,
          { TTL: 60 * 60, urgency: 'high' },
        );
        results.sent += 1;
      } catch (err) {
        const statusCode = err?.statusCode || err?.status;
        if (statusCode === 404 || statusCode === 410) {
          await pushStore.delete(key);
          results.gone += 1;
        } else {
          console.warn('push failed', key, err?.message || err);
          results.errors += 1;
        }
      }
    }
  }

  return results;
}
