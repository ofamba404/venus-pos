import { peekAccessToken } from './auth';
import { VAPID_PUBLIC_KEY } from './env';

/** Body for `POST /api/push/subscribe`, same fields as legacy `subscribeWebPush`. */
export function buildPushSubscribeBody(
  subscription: { endpoint?: string; keys?: Record<string, string> } | null,
  prefs: { orders?: boolean; schedules?: boolean },
) {
  return {
    subscription,
    schedulesEnabled: Boolean(prefs.schedules),
    ordersEnabled: Boolean(prefs.orders),
  };
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushEnableResult = {
  ok: boolean;
  reason: 'granted' | 'denied' | 'default' | 'unsupported' | 'signed-out' | 'server';
};

/**
 * Subscribe this browser under the /next/ worker only.
 * Does not register or replace the root /sw.js worker v1 uses.
 */
export async function enablePush(prefs: { orders?: boolean; schedules?: boolean }): Promise<PushEnableResult> {
  if (
    typeof navigator === 'undefined' ||
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    typeof Notification === 'undefined'
  ) {
    return { ok: false, reason: 'unsupported' };
  }
  let perm: NotificationPermission = Notification.permission;
  if (perm === 'default') {
    try {
      perm = await Notification.requestPermission();
    } catch {
      return { ok: false, reason: 'denied' };
    }
  }
  if (perm !== 'granted') return { ok: false, reason: perm === 'denied' ? 'denied' : 'default' };

  const base = import.meta.env.BASE_URL || '/next/';
  const scope = base.endsWith('/') ? base : `${base}/`;
  let reg: ServiceWorkerRegistration;
  try {
    reg = await navigator.serviceWorker.register(`${scope}sw.js`, { scope });
  } catch {
    return { ok: false, reason: 'unsupported' };
  }

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  const token = peekAccessToken();
  if (!token) return { ok: false, reason: 'signed-out' };
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(buildPushSubscribeBody(sub.toJSON(), prefs)),
  });
  if (!res.ok) return { ok: false, reason: 'server' };
  return { ok: true, reason: 'granted' };
}
