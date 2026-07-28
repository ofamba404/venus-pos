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
  // Always (re)register with orders on — closed-browser alerts depend on this.
  return subscribeWebPush({
    schedulesEnabled: getNotificationPrefs().schedulesEnabled !== false,
    ordersEnabled: true,
  });
}

function showEnablePromptIfNeeded() {
  if (notificationPermission() === 'unsupported') return;
  if (notificationPermission() === 'denied') return;
  if (getNotificationPrefs().pushSubscribed && notificationPermission() === 'granted') return;
  if (document.getElementById('pwaEnableBanner')) return;

  const el = document.createElement('div');
  el.id = 'pwaEnableBanner';
  el.className = 'pwa-enable-banner';
  el.setAttribute('role', 'dialog');
  el.innerHTML = `
    <div class="pwa-enable-banner__copy">
      <div class="pwa-enable-banner__title">Turn on order alerts</div>
      <div class="pwa-enable-banner__body">Required for new storefront orders when POS is closed or the phone is locked. Install the app on Android for the most reliable alerts.</div>
    </div>
    <div class="pwa-enable-banner__actions">
      <button type="button" class="pwa-enable-banner__btn primary" data-pwa-enable>Enable alerts</button>
      <button type="button" class="pwa-enable-banner__btn" data-pwa-enable-dismiss>Later</button>
    </div>`;
  document.body.appendChild(el);

  el.querySelector('[data-pwa-enable]')?.addEventListener('click', async () => {
    el.remove();
    const result = await subscribeWebPush({ ordersEnabled: true, schedulesEnabled: true });
    if (result.ok) {
      setNotificationPrefs({ installHintDismissed: true, ordersEnabled: true });
      const { showToast } = await import('./utils.js');
      showToast('Push on — orders alert even when closed');
      if (!isStandalonePwa()) {
        void promptPwaInstall();
      }
    } else if (result.reason === 'denied') {
      const { showToast } = await import('./utils.js');
      showToast('Notifications blocked — enable in browser settings', true);
    }
  });
  el.querySelector('[data-pwa-enable-dismiss]')?.addEventListener('click', () => {
    el.remove();
    // Soft dismiss only — prompt again next cold boot until they enable.
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

  // Refresh / create push registration aggressively on every boot.
  if (notificationPermission() === 'granted') {
    void ensurePushSubscription().then((r) => {
      if (r.ok) console.info('Venus POS push ready');
      else setTimeout(showEnablePromptIfNeeded, 800);
    });
  } else {
    setTimeout(showEnablePromptIfNeeded, 800);
  }
}
