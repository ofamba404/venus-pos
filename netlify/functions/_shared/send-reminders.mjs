import { getStore } from '@netlify/blobs';
import { remindersDueNow } from './reminders.mjs';
import { env, json, sendToAllStaff } from './push.mjs';

export { json };

/** Send due Kampala reminder pushes to all enabled subscriptions. */
export async function sendDueReminders(date = new Date()) {
  if (!env('VAPID_PUBLIC_KEY') || !env('VAPID_PRIVATE_KEY')) {
    return { ok: false, error: 'VAPID keys not configured', status: 500 };
  }

  const due = remindersDueNow(date, 8);
  if (!due.length) {
    return { ok: true, due: [], sent: 0, skipped: 0, gone: 0, errors: 0 };
  }

  const logStore = getStore({ name: 'venus-push-log', consistency: 'strong' });
  const results = { ok: true, due: due.map((d) => d.id), sent: 0, skipped: 0, gone: 0, errors: 0 };

  for (const slot of due) {
    const logKey = `${slot.dateKey}:${slot.id}`;
    const already = await logStore.get(logKey);
    if (already) {
      results.skipped += 1;
      continue;
    }

    await logStore.set(logKey, new Date().toISOString());

    const wave = await sendToAllStaff({
      type: slot.type,
      title: slot.title,
      body: slot.body,
      url: slot.path,
      tag: slot.id,
      requireInteraction: true,
      schedulesOnly: true,
    });

    if (!wave.ok) {
      results.errors += 1;
      continue;
    }
    results.sent += wave.sent;
    results.gone += wave.gone;
    results.errors += wave.errors;
    results.skipped += wave.skipped;
  }

  return results;
}
