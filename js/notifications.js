/**
 * Reusable browser + in-app notifications for Venus POS.
 *
 * Local Realtime covers open tabs. Web Push covers closed browser /
 * installed PWA via Netlify `/api/push/notify` + the service worker `push` handler.
 */

import { CAT_MAP, getAssetHref, getPageHref, LOW_STOCK_THRESHOLD, VAPID_PUBLIC_KEY } from './config.js';
import { kampalaHour } from './delivery-fee-model.js';

/** @typedef {'delivery-test' | 'storefront-order' | 'stock-low' | 'stock-out' | 'credit' | string} NotifType */

export const NOTIF_TYPE = {
  DELIVERY_TEST: 'delivery-test',
  STOREFRONT_ORDER: 'storefront-order',
  ORDER_CANCELLED: 'order-cancelled',
  STOCK_LOW: 'stock-low',
  STOCK_OUT: 'stock-out',
  CREDIT: 'credit',
};

const PREFS_KEY = 'venus.notif.prefs.v1';
const FIRED_KEY = 'venus.notif.fired.v1';
const STOCK_FIRED_KEY = 'venus.notif.stock.v1';
const POLL_MS = 30_000;

/** @type {ReturnType<typeof setInterval> | null} */
let pollTimer = null;
/** @type {Array<{ id: string, type: NotifType, hour: number, minute: number, title: string, body: string, url: string, enabled?: boolean }>} */
let activeSchedules = [];

function logoNotifUrl() {
  // Circular jade mark — notification tray / shade icon (matches store circular style).
  return new URL(getAssetHref('logo-notif.png'), location.href).href;
}

function logoBadgeUrl() {
  // White leaf + wordmark on transparent — Android status-bar badge (alpha mask).
  // iOS ignores Notification.badge; it uses apple-touch-icon instead.
  return new URL(getAssetHref('logo-badge.png'), location.href).href;
}

/** Home-screen red count on iOS (Add to Home Screen PWA). No-op elsewhere. */
async function bumpAppBadge(count = 1) {
  try {
    if ('setAppBadge' in navigator) await navigator.setAppBadge(count);
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
    ordersEnabled: prefs.ordersEnabled !== false,
    stockEnabled: prefs.stockEnabled !== false,
    pushSubscribed: !!prefs.pushSubscribed,
    installHintDismissed: !!prefs.installHintDismissed,
  };
}

export function setNotificationPrefs(patch) {
  writeJson(PREFS_KEY, { ...getNotificationPrefs(), ...patch });
}

export function notificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export function isStandalonePwa() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // @ts-expect-error iOS Safari
    window.navigator.standalone === true
  );
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
 * Required for order alerts when the browser is closed.
 */
export async function subscribeWebPush({
  schedulesEnabled = getNotificationPrefs().schedulesEnabled,
  ordersEnabled = getNotificationPrefs().ordersEnabled,
} = {}) {
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
      schedulesEnabled: !!schedulesEnabled,
      ordersEnabled: !!ordersEnabled,
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.warn('push subscribe failed', res.status, err);
    return { ok: false, reason: 'server' };
  }

  setNotificationPrefs({
    pushSubscribed: true,
    schedulesEnabled: !!schedulesEnabled,
    ordersEnabled: !!ordersEnabled,
  });
  return { ok: true, subscription: sub };
}

/** Pause/resume server-side prefs, or fully unsubscribe. */
export async function syncWebPushPrefs({
  schedulesEnabled,
  ordersEnabled,
  unsubscribe = false,
} = {}) {
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
    setNotificationPrefs({ pushSubscribed: false, schedulesEnabled: false, ordersEnabled: false });
    return { ok: true, unsubscribed: true };
  }

  const body = { endpoint: sub.endpoint };
  if (typeof schedulesEnabled === 'boolean') body.schedulesEnabled = schedulesEnabled;
  if (typeof ordersEnabled === 'boolean') body.ordersEnabled = ordersEnabled;

  const res = await fetch(pushApi('/api/push/unsubscribe'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, reason: 'server' };

  const patch = { pushSubscribed: true };
  if (typeof schedulesEnabled === 'boolean') patch.schedulesEnabled = schedulesEnabled;
  if (typeof ordersEnabled === 'boolean') patch.ordersEnabled = ordersEnabled;
  setNotificationPrefs(patch);
  return { ok: true };
}

/**
 * Show a notification (SW when available) + optional in-app banner.
 *
 * @param {{
 *   type?: NotifType,
 *   title: string,
 *   body?: string,
 *   url?: string,
 *   tag?: string,
 *   requireInteraction?: boolean,
 *   inApp?: boolean,
 *   silentOs?: boolean,
 * }} opts
 */
export async function showAppNotification(opts) {
  const {
    type = NOTIF_TYPE.DELIVERY_TEST,
    title,
    body = '',
    url = getPageHref('home'),
    tag = `${type}-${Date.now()}`,
    requireInteraction = false,
    inApp = true,
    silentOs = false,
  } = opts;

  if (inApp) {
    showInAppBanner({ type, title, body, url });
  }

  if (silentOs) return { ok: true, via: 'in-app-only' };

  const permission = notificationPermission();
  if (permission !== 'granted') return { ok: false, reason: permission };

  const absoluteUrl = new URL(url, location.href).href;
  const options = {
    body,
    icon: logoNotifUrl(),
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
  const primaryUrl = url || getPageHref('home');
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
    if (document.visibilityState === 'visible') {
      void tickSchedules();
      void clearAppBadge();
    }
  });
}

/**
 * New storefront order — title: "{name} placed an order!"
 * When push is subscribed, OS alert is left to Web Push (same tag) to avoid doubles.
 *
 * @param {{ orderId?: string, customerName?: string, totalLabel?: string, itemCount?: number, url?: string }} order
 */
export async function notifyStorefrontOrder(order = {}) {
  const name = String(order.customerName || '').trim() || 'A customer';
  const parts = [];
  if (order.itemCount) parts.push(`${order.itemCount} item${order.itemCount === 1 ? '' : 's'}`);
  if (order.totalLabel) parts.push(order.totalLabel);
  const body = parts.join(' · ');
  const tag = order.orderId ? `storefront-order-${order.orderId}` : `storefront-order-${Date.now()}`;
  const url = order.url || `${getPageHref('home')}#store-orders`;
  const pushOn = getNotificationPrefs().pushSubscribed;

  return showAppNotification({
    type: NOTIF_TYPE.STOREFRONT_ORDER,
    title: `${name} placed an order!`,
    body,
    url,
    tag,
    requireInteraction: true,
    inApp: true,
    // Prefer server Web Push for the OS alert when subscribed (same tag).
    silentOs: pushOn,
  });
}

/**
 * Customer cancelled their storefront order.
 * @param {{ orderId?: string, customerName?: string, url?: string }} order
 */
export async function notifyOrderCancelled(order = {}) {
  const name = String(order.customerName || '').trim() || 'A customer';
  const pushOn = getNotificationPrefs().pushSubscribed;
  return showAppNotification({
    type: NOTIF_TYPE.ORDER_CANCELLED,
    title: 'Order cancelled',
    body: `${name} cancelled their order`,
    url: order.url || `${getPageHref('home')}#store-orders`,
    tag: order.orderId ? `storefront-order-cancelled-${order.orderId}` : `order-cancelled-${Date.now()}`,
    requireInteraction: true,
    inApp: true,
    silentOs: pushOn,
  });
}

function stockLabel(categoryId) {
  const cat = CAT_MAP[categoryId];
  if (!cat) return categoryId;
  return cat.sub ? `${cat.name} ${cat.sub}` : cat.name;
}

function stockFiredToday(key) {
  const fired = readJson(STOCK_FIRED_KEY, {});
  return fired[key] === kampalaDateKey();
}

function markStockFired(key) {
  const fired = readJson(STOCK_FIRED_KEY, {});
  fired[key] = kampalaDateKey();
  writeJson(STOCK_FIRED_KEY, fired);
}

/**
 * Fire when stock crosses into low / out after a checkout or manual adjust.
 * Deduped once per category per Kampala day.
 *
 * @param {string} categoryId
 * @param {number} previous
 * @param {number} next
 */
export async function notifyStockCrossing(categoryId, previous, next) {
  if (!getNotificationPrefs().stockEnabled) return { ok: false, reason: 'disabled' };
  const prev = Number(previous);
  const cur = Number(next);
  if (!Number.isFinite(prev) || !Number.isFinite(cur)) return { ok: false, reason: 'bad-stock' };
  if (cur >= prev) return { ok: false, reason: 'restock' };

  const label = stockLabel(categoryId);
  const invUrl = getPageHref('inventory');

  if (cur === 0 && prev > 0) {
    const key = `out:${categoryId}`;
    if (stockFiredToday(key)) return { ok: false, reason: 'deduped' };
    markStockFired(key);
    return showAppNotification({
      type: NOTIF_TYPE.STOCK_OUT,
      title: `${label} is out of stock`,
      body: 'Restock before the next order.',
      url: invUrl,
      tag: key,
      requireInteraction: true,
      inApp: true,
    });
  }

  if (cur > 0 && cur < LOW_STOCK_THRESHOLD && prev >= LOW_STOCK_THRESHOLD) {
    const key = `low:${categoryId}`;
    if (stockFiredToday(key)) return { ok: false, reason: 'deduped' };
    markStockFired(key);
    return showAppNotification({
      type: NOTIF_TYPE.STOCK_LOW,
      title: `${label} is running low`,
      body: `${cur} left · threshold ${LOW_STOCK_THRESHOLD}`,
      url: invUrl,
      tag: key,
      requireInteraction: false,
      inApp: true,
    });
  }

  return { ok: false, reason: 'no-cross' };
}

/**
 * Credit sale recorded — light heads-up on the open register.
 * @param {{ clientName?: string, totalLabel?: string, url?: string }} sale
 */
export async function notifyCreditSale(sale = {}) {
  const name = String(sale.clientName || '').trim() || 'A client';
  return showAppNotification({
    type: NOTIF_TYPE.CREDIT,
    title: 'Credit sale recorded',
    body: sale.totalLabel ? `${name} · ${sale.totalLabel}` : name,
    url: sale.url || getPageHref('analytics'),
    tag: `credit-${Date.now()}`,
    requireInteraction: false,
    inApp: true,
  });
}
