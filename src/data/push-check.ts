import { peekAccessToken } from './auth';
import { VAPID_PUBLIC_KEY } from './env';

export type CheckLine = { id: string; label: string; ok: boolean; detail: string };

function keyBytes(base64: string) {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Array.from(raw, (c) => c.charCodeAt(0));
}

function sameKey(a: ArrayBuffer | null | undefined, b: string) {
  if (!a) return false;
  const x = Array.from(new Uint8Array(a));
  const y = keyBytes(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * Walk the whole path on this phone and say which step breaks.
 * Steps: support, permission, worker, subscription (and its key), a local notification, then one real push from the server.
 * Stops at the first failure so the line that is red is the cause.
 */
export async function runNotificationCheck(onLine: (line: CheckLine) => void): Promise<CheckLine[]> {
  const lines: CheckLine[] = [];
  const add = (line: CheckLine) => {
    lines.push(line);
    onLine(line);
    return line.ok;
  };

  if (
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    typeof Notification === 'undefined'
  ) {
    add({ id: 'support', label: 'Browser', ok: false, detail: 'This browser cannot do background notifications. Use Chrome or Edge, or install the app.' });
    return lines;
  }
  add({ id: 'support', label: 'Browser', ok: true, detail: 'Supports notifications' });

  if (Notification.permission !== 'granted') {
    add({
      id: 'permission',
      label: 'Permission',
      ok: false,
      detail:
        Notification.permission === 'denied'
          ? 'Blocked. Allow notifications for this site in the browser or phone settings.'
          : 'Not asked yet. Tap Enable notifications first.',
    });
    return lines;
  }
  add({ id: 'permission', label: 'Permission', ok: true, detail: 'Allowed' });

  const base = import.meta.env.BASE_URL || '/next/';
  const scope = base.endsWith('/') ? base : `${base}/`;
  const reg = await navigator.serviceWorker.getRegistration(scope).catch(() => undefined);
  if (!reg || !reg.active) {
    add({ id: 'worker', label: 'Worker', ok: false, detail: `No active worker for ${scope}. Tap Enable notifications.` });
    return lines;
  }
  add({ id: 'worker', label: 'Worker', ok: true, detail: `Active at ${new URL(reg.scope).pathname}` });

  const sub = await reg.pushManager.getSubscription().catch(() => null);
  if (!sub) {
    add({ id: 'subscription', label: 'Subscription', ok: false, detail: 'This phone has no push subscription. Tap Enable notifications.' });
    return lines;
  }
  if (!sameKey(sub.options?.applicationServerKey, VAPID_PUBLIC_KEY)) {
    add({ id: 'subscription', label: 'Subscription', ok: false, detail: 'Made with an old key. Tap Enable notifications to renew it.' });
    return lines;
  }
  add({ id: 'subscription', label: 'Subscription', ok: true, detail: 'Present, matches the server key' });

  try {
    await reg.showNotification('Venus test (on this phone)', {
      body: 'Shown by the phone itself, no server involved.',
      icon: `${scope}assets/logo-notif.png`,
      badge: `${scope}assets/logo-badge.png`,
      tag: 'venus-test-local',
    });
    add({ id: 'local', label: 'Show a notification', ok: true, detail: 'Sent to the phone. Look for "Venus test (on this phone)". If you see nothing, the phone is hiding them (silent mode, app notifications off).' });
  } catch (err) {
    add({ id: 'local', label: 'Show a notification', ok: false, detail: err instanceof Error ? err.message : 'The browser refused to show it' });
    return lines;
  }

  const token = peekAccessToken();
  if (!token) {
    add({ id: 'server', label: 'Push from server', ok: false, detail: 'Signed out. Sign in again.' });
    return lines;
  }
  try {
    const res = await fetch('/api/push/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; pushService?: string };
    if (res.ok && body.ok) {
      add({ id: 'server', label: 'Push from server', ok: true, detail: `Sent through ${body.pushService || 'the push service'}. A second "Venus test" should arrive within seconds, even with the app closed.` });
    } else {
      add({ id: 'server', label: 'Push from server', ok: false, detail: body.error || `Server answered ${res.status}` });
    }
  } catch {
    add({ id: 'server', label: 'Push from server', ok: false, detail: 'Could not reach the server' });
  }
  return lines;
}
