/**
 * Reusable browser + in-app notifications for Venus POS.
 *
 * Same surface powers SafeBoda quote-test reminders today and can later
 * drive storefront "new order" alerts — pass a different `type` + `url`.
 */

import { getAssetHref, getPageHref } from './config.js';
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
  // PNG is more reliable than SVG for Notification icons across browsers.
  return new URL(getAssetHref('logo.png'), location.href).href;
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
    badge: logoIconUrl(),
    tag,
    renotify: true,
    requireInteraction,
    data: { type, url: absoluteUrl },
  };

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, options);
      return { ok: true, via: 'service-worker' };
    }
  } catch (e) {
    console.warn('SW notification failed, falling back', e);
  }

  try {
    const n = new Notification(title, options);
    n.onclick = () => {
      window.focus();
      if (absoluteUrl && absoluteUrl !== location.href) location.href = absoluteUrl;
      n.close();
    };
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
  const nowMin = kampalaMinuteOfDay();

  for (const s of activeSchedules) {
    if (s.enabled === false) continue;
    const target = s.hour * 60 + (s.minute || 0);
    // Fire in a 2-minute window so a 30s poll won't miss the slot.
    if (nowMin < target || nowMin > target + 1) continue;
    if (wasFiredToday(s.id)) continue;

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
