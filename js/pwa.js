/**
 * Venus POS PWA — install prompt, push bootstrap, notification click routing.
 */

import { DELIVERY_TEST_REMINDERS } from './delivery-test-routes.js';
import {
  getNotificationPrefs,
  isStandalonePwa,
  notificationPermission,
  setNotificationPrefs,
  startNotificationRuntime,
  subscribeWebPush,
} from './notifications.js';

/** @type {BeforeInstallPromptEvent | null} */
let deferredInstall = null;
let booted = false;

export function getDeferredInstallPrompt() {
  return deferredInstall;
}

export async function promptPwaInstall() {
  if (deferredInstall) {
    deferredInstall.prompt();
    const choice = await deferredInstall.userChoice.catch(() => null);
    deferredInstall = null;
    updateInstallUi();
    if (choice?.outcome === 'accepted') {
      void ensurePushSubscription();
    }
    return { ok: true, outcome: choice?.outcome || 'unknown' };
  }

  const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isiOS) {
    window.alert('To install Venus POS: tap Share, then “Add to Home Screen”.');
    return { ok: true, outcome: 'ios-hint' };
  }
  window.alert('Install isn’t available in this browser yet. Try Chrome or Edge.');
  return { ok: false, reason: 'unavailable' };
}

export function updateInstallUi() {
  const show = !isStandalonePwa();
  document.querySelectorAll('[data-pwa-install-item]').forEach((el) => {
    el.hidden = !show;
  });
  document.querySelectorAll('[data-pwa-install]').forEach((btn) => {
    btn.disabled = false;
  });
}

async function ensurePushSubscription() {
  const prefs = getNotificationPrefs();
  if (notificationPermission() !== 'granted') return { ok: false, reason: 'permission' };
  return subscribeWebPush({
    schedulesEnabled: prefs.schedulesEnabled,
    ordersEnabled: prefs.ordersEnabled,
  });
}

function showEnablePromptIfNeeded() {
  if (isStandalonePwa()) return;
  if (notificationPermission() === 'granted') return;
  if (notificationPermission() === 'unsupported') return;
  if (getNotificationPrefs().installHintDismissed) return;
  if (document.getElementById('pwaEnableBanner')) return;

  const el = document.createElement('div');
  el.id = 'pwaEnableBanner';
  el.className = 'pwa-enable-banner';
  el.setAttribute('role', 'dialog');
  el.innerHTML = `
    <div class="pwa-enable-banner__copy">
      <div class="pwa-enable-banner__title">Get order alerts</div>
      <div class="pwa-enable-banner__body">Enable notifications so new storefront orders reach you even when POS is closed.</div>
    </div>
    <div class="pwa-enable-banner__actions">
      <button type="button" class="pwa-enable-banner__btn primary" data-pwa-enable>Enable</button>
      <button type="button" class="pwa-enable-banner__btn" data-pwa-enable-dismiss>Not now</button>
    </div>`;
  document.body.appendChild(el);

  el.querySelector('[data-pwa-enable]')?.addEventListener('click', async () => {
    el.remove();
    setNotificationPrefs({ installHintDismissed: true });
    const result = await subscribeWebPush({ ordersEnabled: true, schedulesEnabled: true });
    if (result.ok) {
      const { showToast } = await import('./utils.js');
      showToast('Push on — orders alert even when closed');
    }
  });
  el.querySelector('[data-pwa-enable-dismiss]')?.addEventListener('click', () => {
    el.remove();
    setNotificationPrefs({ installHintDismissed: true });
  });
}

/** Call once after shell mount — idempotent. */
export function bootPwa() {
  if (booted) return;
  booted = true;

  startNotificationRuntime(DELIVERY_TEST_REMINDERS);

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstall = event;
    updateInstallUi();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    updateInstallUi();
    void ensurePushSubscription();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      const url = event.data?.url;
      if (event.data?.type === 'venus-notif-click' && url) {
        location.href = url;
      }
    });
  }

  document.querySelectorAll('[data-pwa-install]').forEach((btn) => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      void promptPwaInstall();
    });
  });
  updateInstallUi();

  // Quietly refresh push registration when already granted.
  if (notificationPermission() === 'granted') {
    void ensurePushSubscription().then((r) => {
      if (r.ok) console.info('Venus POS push ready');
    });
  } else {
    // Soft prompt after first paint — don't block checkout.
    setTimeout(showEnablePromptIfNeeded, 2500);
  }
}
