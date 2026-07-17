/**
 * Reusable browser + in-app notifications for Venus POS.
 *
 * Local polling covers open tabs. Web Push (Enable) covers closed browser
 * via Netlify scheduled functions + the service worker `push` handler.
 */

import { getAssetHref, getPageHref, VAPID_PUBLIC_KEY } from './config.js';
import { kampalaHour } from './delivery-fee-model.js';

/** @typedef {'delivery-test' | 'storefront-order' | string} NotifType */

export const NOTIF_TYPE = {
  DELIVERY_TEST: 'delivery-test',
  STOREFRONT_ORDER: 'storefront-order',
};

const PREFS_KEY = 'venus.notif.prefs.v1';
const FIRED_KEY = 'venus.notif.fired.v1';
const POLL_MS = 30_000;

/** @type {ReturnType<typeof setInterval> | null} */
let pollTimer = null;
/** @type {Array<{ id: string, type: NotifType, hour: number, minute: number, title: string, body: string, url: string, enabled?: boolean }>} */
let activeSchedules = [];

function logoIconUrl() {
  return new URL(getAssetHref('logo-browser.svg'), location.href).href;
}

function logoBadgeUrl() {
  // White leaf + wordmark on transparent — Android status-bar badge (alpha mask).
  // iOS ignores Notification.badge; it uses apple-touch-icon instead.
  return new URL(getAssetHref('logo-badge.png'), location.href).href;
}

/** Home-screen red count on iOS (Add to Home Screen PWA). No-op elsewhere. */
async function bumpAppBadge() {
  try {
    if ('setAppBadge' in navigator) await navigator.setAppBadge(1);
  } catch {
    /* unsupported / denied */
  }
}

export async function clearAppBadge() {
  try {
    if ('clearAppBadge' in navigator) await navigator.clearAppBadge();
  } catch {
    /* unsupported */
  }
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — ignore */
  }
}

export function getNotificationPrefs() {
  const prefs = readJson(PREFS_KEY, {});
  return {
    permissionAsked: !!prefs.permissionAsked,
    schedulesEnabled: prefs.schedulesEnabled !== false,
    pushSubscribed: !!prefs.pushSubscribed,
  };
}

export function setNotificationPrefs(patch) {
  writeJson(PREFS_KEY, { ...getNotificationPrefs(), ...patch });
}

export function notificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

/**
 * Ask once for browser notification permission.
 * Safe to call repeatedly — only prompts when still `default`.
 */
export async function ensureNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  setNotificationPrefs({ permissionAsked: true });
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function pushApi(path) {
  return new URL(path, location.origin).href;
}

/**
 * Subscribe this device to Web Push and register the endpoint with Netlify.
 * Required for reminders when the browser is closed.
 */
export async function subscribeWebPush({ schedulesEnabled = true } = {}) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: 'unsupported' };
  }
  const perm = await ensureNotificationPermission();
  if (perm !== 'granted') return { ok: false, reason: perm };

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const res = await fetch(pushApi('/api/push/subscribe'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subscription: sub.toJSON(),
      schedulesEnabled,
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.warn('push subscribe failed', res.status, err);
    return { ok: false, reason: 'server' };
  }

  setNotificationPrefs({ pushSubscribed: true, schedulesEnabled });
  return { ok: true, subscription: sub };
}

/** Pause/resume server-side schedules, or fully unsubscribe. */
export async function syncWebPushPrefs({ schedulesEnabled, unsubscribe = false } = {}) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: 'unsupported' };
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) {
    setNotificationPrefs({ pushSubscribed: false });
    return { ok: true, missing: true };
  }

  if (unsubscribe) {
    try {
      await fetch(pushApi('/api/push/unsubscribe'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
    } catch (e) {
      console.warn('push unsubscribe sync failed', e);
    }
    try {
      await sub.unsubscribe();
    } catch {
      /* ignore */
    }
    setNotificationPrefs({ pushSubscribed: false, schedulesEnabled: false });
    return { ok: true, unsubscribed: true };
  }

  const res = await fetch(pushApi('/api/push/unsubscribe'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: sub.endpoint,
      schedulesEnabled: !!schedulesEnabled,
    }),
  });
  if (!res.ok) return { ok: false, reason: 'server' };
  setNotificationPrefs({ schedulesEnabled: !!schedulesEnabled, pushSubscribed: true });
  return { ok: true };
}

/**
 * Show a notification (SW when available) + optional in-app banner.
 * Repurpose for storefront orders with type STOREFRONT_ORDER and an orders URL.
 *
 * @param {{
 *   type?: NotifType,
 *   title: string,
 *   body?: string,
 *   url?: string,
 *   tag?: string,
 *   requireInteraction?: boolean,
 *   inApp?: boolean,
 * }} opts
 */
export async function showAppNotification(opts) {
  const {
    type = NOTIF_TYPE.DELIVERY_TEST,
    title,
    body = '',
    url = getPageHref('delivery'),
    tag = `${type}-${Date.now()}`,
    requireInteraction = false,
    inApp = true,
  } = opts;

  if (inApp) {
    showInAppBanner({ type, title, body, url });
  }

  const permission = notificationPermission();
  if (permission !== 'granted') return { ok: false, reason: permission };

  const absoluteUrl = new URL(url, location.href).href;
  const options = {
    body,
    icon: logoIconUrl(),
    badge: logoBadgeUrl(),
    tag,
    renotify: true,
    requireInteraction,
    data: { type, url: absoluteUrl },
  };

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, options);
      await bumpAppBadge();
      return { ok: true, via: 'service-worker' };
    }
  } catch (e) {
    console.warn('SW notification failed, falling back', e);
  }

  try {
    const n = new Notification(title, options);
    n.onclick = () => {
      window.focus();
      clearAppBadge();
      if (absoluteUrl && absoluteUrl !== location.href) location.href = absoluteUrl;
      n.close();
    };
    await bumpAppBadge();
    return { ok: true, via: 'notification-api' };
  } catch (e) {
    console.warn('Notification API failed', e);
    return { ok: false, reason: 'error' };
  }
}

/**
 * In-app banner — works even when Notification permission is denied.
 */
export function showInAppBanner({ type = NOTIF_TYPE.DELIVERY_TEST, title, body = '', url = null, actions = null }) {
  let el = document.getElementById('inAppBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'inAppBanner';
    el.className = 'in-app-banner';
    el.setAttribute('role', 'status');
    el.hidden = true;
    document.body.appendChild(el);
  }

  const logo = getAssetHref('logo.svg');
  const primaryUrl = url || getPageHref('delivery');
  const actionHtml =
    actions ||
    `<a class="in-app-banner-cta" href="${primaryUrl}">Open</a>
     <button type="button" class="in-app-banner-dismiss" data-banner-dismiss>Dismiss</button>`;

  el.dataset.type = type;
  el.hidden = false;
  el.innerHTML = `
    <span class="in-app-banner-logo-wrap" aria-hidden="true">
      <img class="in-app-banner-logo" src="${logo}" alt="" width="32" height="32" decoding="async" />
    </span>
    <div class="in-app-banner-copy">
      <div class="in-app-banner-title">${escapeBanner(title)}</div>
      ${body ? `<div class="in-app-banner-body">${escapeBanner(body)}</div>` : ''}
    </div>
    <div class="in-app-banner-actions">${actionHtml}</div>`;

  el.querySelector('[data-banner-dismiss]')?.addEventListener('click', () => {
    el.hidden = true;
  });

  clearTimeout(showInAppBanner._t);
  showInAppBanner._t = setTimeout(() => {
    if (el && !el.hidden) el.hidden = true;
  }, 14_000);
}

function escapeBanner(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function kampalaMinuteOfDay(date = new Date()) {
  const hour = kampalaHour(date);
  // Derive Kampala minutes from UTC+3 without Intl dependency edge cases.
  const utcMin = date.getUTCMinutes();
  return hour * 60 + utcMin;
}

function kampalaDateKey(date = new Date()) {
  const utc = date.getTime() + 3 * 60 * 60 * 1000;
  const d = new Date(utc);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function wasFiredToday(scheduleId) {
  const fired = readJson(FIRED_KEY, {});
  return fired[scheduleId] === kampalaDateKey();
}

function markFiredToday(scheduleId) {
  const fired = readJson(FIRED_KEY, {});
  fired[scheduleId] = kampalaDateKey();
  writeJson(FIRED_KEY, fired);
}

/**
 * Register local wall-clock schedules (Kampala time).
 * Checked every 30s while the app (any page) is open.
 */
export function setLocalSchedules(schedules) {
  activeSchedules = Array.isArray(schedules) ? schedules : [];
}

async function tickSchedules() {
  if (!getNotificationPrefs().schedulesEnabled) return;
  // When Web Push is registered, the Netlify cron delivers closed-browser
  // reminders — skip local duplicates while the tab is open.
  if (getNotificationPrefs().pushSubscribed) return;

  const nowMin = kampalaMinuteOfDay();

  const due = activeSchedules
    .filter((s) => s.enabled !== false)
    .map((s) => ({ s, target: s.hour * 60 + (s.minute || 0) }))
    .filter(({ s, target }) => nowMin >= target && !wasFiredToday(s.id))
    .sort((a, b) => a.target - b.target);

  for (const { s } of due) {
    markFiredToday(s.id);
    await showAppNotification({
      type: s.type || NOTIF_TYPE.DELIVERY_TEST,
      title: s.title,
      body: s.body,
      url: s.url,
      tag: s.id,
      requireInteraction: true,
      inApp: true,
    });
  }
}

/** Boot polling — call once from app init. Idempotent. */
export function startNotificationRuntime(schedules = []) {
  if (schedules.length) setLocalSchedules(schedules);
  if (pollTimer != null) return;
  void tickSchedules();
  pollTimer = setInterval(() => void tickSchedules(), POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void tickSchedules();
  });
}

/**
 * Convenience: storefront can later call the same helper.
 * Groundwork only — no storefront wiring yet.
 *
 * @param {{ orderId?: string, customerName?: string, totalLabel?: string, url?: string }} order
 */
export async function notifyStorefrontOrder(order = {}) {
  const name = order.customerName || 'a customer';
  const total = order.totalLabel ? ` · ${order.totalLabel}` : '';
  return showAppNotification({
    type: NOTIF_TYPE.STOREFRONT_ORDER,
    title: 'New storefront order',
    body: `${name}${total}`,
    url: order.url || getPageHref('home'),
    tag: order.orderId ? `storefront-order-${order.orderId}` : `storefront-order-${Date.now()}`,
    requireInteraction: true,
    inApp: true,
  });
}
