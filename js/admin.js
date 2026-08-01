/**
 * POS admin page — overview, storefront users, register clients, hours, tools.
 * Header shield icon links here via getPageHref('admin').
 */

import { CATEGORIES, LOW_STOCK_THRESHOLD, SUPABASE_ANON_JWT, SUPABASE_URL, getPageHref } from './config.js';
import { sbFetch } from './api.js';
import {
  getNotificationPrefs,
  notificationPermission,
  subscribeWebPush,
} from './notifications.js';
import { promptPwaInstall, updateInstallUi } from './pwa.js';
import {
  getCart,
  clients,
  inventory,
  resetDraftStock,
  setCart,
  setOrderMeta,
} from './state.js';
import { escapeHtml, showConfirm, showToast } from './utils.js';
import { applyPosLabels, upsertPosLabel } from './pos-labels.js';
import { dataStore } from './store/index.js';
import { getStackedStoreOrders, onStoreOrdersChange, openStoreOrdersPanel } from './store-orders.js';
import {
  busyUntilFromNow,
  formatBusyUntilLabel,
  formatOpenHoursLabel,
  formatSuggestRangeLabel,
  formatUntilClock,
  getFulfillmentStatus,
  hasBusyUntil,
  isBusyActive,
  isWithinOpenHours,
  loadFulfillmentStatus,
  nextOpenAt,
  saveFulfillmentStatus,
  toDatetimeLocalValue,
  toHHmm,
} from './fulfillment.js';

const STORE_AUTH_URL = `${SUPABASE_URL}/functions/v1/store-auth`;
const ADMIN_TABS = new Set(['overview', 'users', 'clients', 'hours', 'tools']);

/** @typedef {'overview' | 'users' | 'clients' | 'hours' | 'tools'} AdminTab */

/** @type {AdminTab} */
let activeTab = 'overview';
/** @type {Array<Record<string, unknown>>} */
let storeUsers = [];
let usersLoaded = false;
let usersError = '';
let hoursLoaded = false;
let hoursError = '';
let hoursSaving = false;
let usersQuery = '';
let clientsQuery = '';
let pageWired = false;
/** Invalidates in-flight user list fetches after local mutations (e.g. delete). */
let usersLoadEpoch = 0;

const ADMIN_ICON_VERIFY = `<svg class="admin-user-row__icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M6.4 11.6 2.8 8l1.2-1.2 2.4 2.4 5.2-5.2L12.8 5.2z"/></svg>`;
const ADMIN_ICON_RENAME = `<svg class="admin-user-row__icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M11.7 2.3a1 1 0 0 1 1.4 1.4L6.4 10.4 3.5 11l.6-2.9 6.7-6.8zM2.5 13h11v1.5h-11z"/></svg>`;
const ADMIN_ICON_DELETE = `<svg class="admin-user-row__icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M6.2 2.5h3.6l.4 1H13V5H3V3.5h2.8l.4-1zM4.5 6h7l-.5 7.2a1 1 0 0 1-1 .8H6a1 1 0 0 1-1-.8L4.5 6zm2 1.5V12h1.2V7.5H6.5zm2.8 0V12H10.5V7.5H9.3z"/></svg>`;

function userPosLabel(user) {
  const alias = String(user?.pos_display_name || '').trim();
  if (alias) return alias;
  return String(user?.snapchat_name || 'User').trim() || 'User';
}

function formatPhone(user) {
  const cc = String(user.phone_country_code || '').replace(/\D/g, '');
  const national = String(user.phone_national || '').replace(/\D/g, '');
  if (!national) return '';
  return cc ? `+${cc}${national}` : national;
}

function formatDate(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

function tabFromHash() {
  const raw = String(location.hash || '').replace(/^#/, '').toLowerCase();
  return ADMIN_TABS.has(raw) ? /** @type {AdminTab} */ (raw) : 'overview';
}

function setTab(tab, { syncHash = true } = {}) {
  activeTab = ADMIN_TABS.has(tab) ? tab : 'overview';
  if (syncHash) {
    const next = `#${activeTab}`;
    if (location.hash !== next) {
      history.replaceState(null, '', `${location.pathname}${location.search}${next}`);
    }
  }
  renderAdminPage();
  if (activeTab === 'hours' && !hoursLoaded) {
    void loadHours().then(() => {
      if (activeTab === 'hours') renderAdminPage();
    });
  }
}

async function storeAuth(action, body = {}) {
  const res = await fetch(STORE_AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_JWT,
      Authorization: `Bearer ${SUPABASE_ANON_JWT}`,
    },
    body: JSON.stringify({ action, ...body }),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

async function loadStoreUsers() {
  const epoch = ++usersLoadEpoch;
  usersError = '';
  try {
    const data = await storeAuth('admin_list_users');
    if (epoch !== usersLoadEpoch) return;
    storeUsers = Array.isArray(data.users) ? data.users : [];
    applyPosLabels(storeUsers);
    usersLoaded = true;
  } catch (e) {
    if (epoch !== usersLoadEpoch) return;
    usersError = e?.message || 'Could not load storefront users';
    storeUsers = [];
    usersLoaded = true;
  }
}

async function loadHours() {
  hoursError = '';
  try {
    await loadFulfillmentStatus();
    hoursLoaded = true;
  } catch (e) {
    hoursError = e?.message || 'Could not load hours';
    hoursLoaded = true;
  }
}

function stockSnapshot() {
  let low = 0;
  let out = 0;
  CATEGORIES.forEach((c) => {
    const n = Number(inventory[c.id] ?? 0);
    if (n <= 0) out += 1;
    else if (n < LOW_STOCK_THRESHOLD) low += 1;
  });
  return { low, out, total: CATEGORIES.length };
}

function waitingOrdersCount() {
  return getStackedStoreOrders().filter(
    (o) => o.status === 'pending' || o.status === 'confirmed',
  ).length;
}

function tabButtonsSync() {
  document.querySelectorAll('[data-admin-tab]').forEach((btn) => {
    const on = btn.getAttribute('data-admin-tab') === activeTab;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

function filteredUsers() {
  const q = usersQuery.trim().toLowerCase();
  if (!q) return storeUsers;
  return storeUsers.filter((user) => {
    const name = String(user.snapchat_name || '').toLowerCase();
    const posName = String(user.pos_display_name || '').toLowerCase();
    const phone = formatPhone(user).toLowerCase();
    const referral = String(user.referral_code || '').toLowerCase();
    const location = String(user.location_label || '').toLowerCase();
    const referred = String(user.referred_by_name || user.referred_by_code || '').toLowerCase();
    return (
      name.includes(q) ||
      posName.includes(q) ||
      phone.includes(q) ||
      referral.includes(q) ||
      location.includes(q) ||
      referred.includes(q)
    );
  });
}

function filteredClients() {
  const list = [...clients].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  const q = clientsQuery.trim().toLowerCase();
  if (!q) return list;
  return list.filter((c) => String(c.name || '').toLowerCase().includes(q));
}

function metaJoin(parts) {
  return parts
    .filter(Boolean)
    .map((part) => `<span>${escapeHtml(part)}</span>`)
    .join('');
}

function usersListHtml() {
  if (!usersLoaded) {
    return `<div class="admin-empty">Loading storefront users…</div>`;
  }
  if (usersError) {
    return `<div class="admin-empty admin-empty--error">${escapeHtml(usersError)}</div>`;
  }
  const list = filteredUsers();
  if (!storeUsers.length) {
    return `<div class="admin-empty">No storefront accounts yet</div>`;
  }
  if (!list.length) {
    return `<div class="admin-empty">No users match “${escapeHtml(usersQuery.trim())}”</div>`;
  }

  return `
    <ol class="admin-user-list">
      ${list
        .map((user, index) => {
          const snapName = String(user.snapchat_name || 'User').trim() || 'User';
          const posName = String(user.pos_display_name || '').trim();
          const displayName = posName || snapName;
          const created = formatDate(user.created_at);
          const referral = String(user.referral_code || '').trim();
          const phone = formatPhone(user);
          const location = String(user.location_label || '').trim();
          const referredByName = String(user.referred_by_name || '').trim();
          const referredByCode = String(user.referred_by_code || '').trim();
          const referredBy = referredByName
            ? `Referred by ${referredByName}`
            : referredByCode
              ? `Referred by ${referredByCode}`
              : '';
          const isVerified = Boolean(user.verified);
          const accountHint = posName ? `Account · ${snapName}` : '';
          const extra = metaJoin([accountHint, created, phone, location, referral]);
          const verifyLabel = isVerified ? 'Remove verification' : 'Verify account';
          const hasExtra = Boolean(extra || referredBy);
          return `
            <li class="admin-user-row${isVerified ? ' is-verified' : ''}" data-user-id="${escapeHtml(String(user.id || ''))}">
              <div class="admin-user-row__index">${index + 1}</div>
              <button type="button" class="admin-user-row__toggle" data-user-expand ${hasExtra ? '' : 'disabled'} aria-expanded="false">
                <span class="admin-user-row__name">${escapeHtml(displayName)}</span>
                ${hasExtra ? '<span class="admin-user-row__chevron" aria-hidden="true"></span>' : ''}
              </button>
              <div class="admin-user-row__actions">
                <button type="button" class="admin-user-row__rename" data-rename-store-user="${escapeHtml(String(user.id || ''))}" title="Set POS name" aria-label="Set POS name">${ADMIN_ICON_RENAME}</button>
                <button type="button" class="admin-user-row__verify ${isVerified ? 'is-verified' : ''}" data-verify-store-user="${escapeHtml(String(user.id || ''))}" data-verified="${isVerified ? '1' : '0'}" title="${verifyLabel}" aria-label="${verifyLabel}" aria-pressed="${isVerified ? 'true' : 'false'}">${ADMIN_ICON_VERIFY}</button>
                <button type="button" class="admin-user-row__delete" data-delete-store-user="${escapeHtml(String(user.id || ''))}" title="Delete account" aria-label="Delete account">${ADMIN_ICON_DELETE}</button>
              </div>
              ${
                hasExtra
                  ? `<div class="admin-user-row__extra" hidden>
                      ${extra ? `<div class="admin-user-row__meta">${extra}</div>` : ''}
                      ${referredBy ? `<div class="admin-user-row__referred">${escapeHtml(referredBy)}</div>` : ''}
                    </div>`
                  : ''
              }
            </li>`;
        })
        .join('')}
    </ol>`;
}

function clientsListHtml() {
  const list = filteredClients();
  if (!clients.length) {
    return `<div class="admin-empty">No register clients yet</div>`;
  }
  if (!list.length) {
    return `<div class="admin-empty">No clients match “${escapeHtml(clientsQuery.trim())}”</div>`;
  }
  return `
    <ol class="admin-user-list">
      ${list
        .map(
          (client, index) => `
        <li class="admin-user-row" data-client-id="${escapeHtml(client.id)}">
          <div class="admin-user-row__index">${index + 1}</div>
          <div class="admin-user-row__main">
            <div class="admin-user-row__name">${escapeHtml(client.name || 'Client')}</div>
            ${
              client.created_at
                ? `<div class="admin-user-row__meta"><span>${escapeHtml(formatDate(client.created_at))}</span></div>`
                : ''
            }
          </div>
          <div class="admin-user-row__actions">
            <button type="button" class="admin-user-row__delete" data-delete-client="${escapeHtml(client.id)}" title="Delete client" aria-label="Delete client">${ADMIN_ICON_DELETE}</button>
          </div>
        </li>`,
        )
        .join('')}
    </ol>`;
}

function overviewHtml() {
  const status = getFulfillmentStatus();
  const busy = hoursLoaded && isBusyActive(status);
  const closed = hoursLoaded && !busy && !isWithinOpenHours(new Date(), status);
  const hoursBlocked = busy || closed;
  const stock = stockSnapshot();
  const waiting = waitingOrdersCount();
  const cartCount = getCart().length;
  const perm = notificationPermission();
  const prefs = getNotificationPrefs();
  const pushOn = prefs.pushSubscribed && perm === 'granted';
  const hoursCopy = !hoursLoaded
    ? 'Loading…'
    : hoursError
      ? hoursError
      : busy
        ? `Busy until ${formatBusyUntilLabel(status) || 'later'}`
        : closed
          ? `Closed · opens ${formatUntilClock(nextOpenAt(new Date(), status))}`
          : `Open · ${formatOpenHoursLabel(status)}`;

  return `
    <div class="admin-overview">
      <div class="admin-stat-row admin-stat-row--wide">
        <div class="admin-stat"><span class="admin-stat__n">${usersLoaded ? storeUsers.length : '—'}</span><span class="admin-stat__l">Store users</span></div>
        <div class="admin-stat"><span class="admin-stat__n">${clients.length}</span><span class="admin-stat__l">Clients</span></div>
        <div class="admin-stat"><span class="admin-stat__n">${waiting}</span><span class="admin-stat__l">Waiting orders</span></div>
        <div class="admin-stat"><span class="admin-stat__n">${stock.low}</span><span class="admin-stat__l">Low stock</span></div>
      </div>

      <div class="admin-overview__cards">
        <button type="button" class="admin-overview__card ${hoursBlocked ? 'is-busy' : 'is-open'}" data-admin-goto="hours">
          <div class="admin-overview__card-label">${busy ? 'Busy' : closed ? 'Closed' : 'Available'}</div>
          <div class="admin-overview__card-title">${escapeHtml(hoursCopy)}</div>
          <div class="admin-overview__card-sub">Tap to manage hours &amp; busy</div>
        </button>
        <button type="button" class="admin-overview__card" data-admin-action="open-orders">
          <div class="admin-overview__card-label">Order stack</div>
          <div class="admin-overview__card-title">${waiting} waiting · ${cartCount} in cart</div>
          <div class="admin-overview__card-sub">Review storefront orders</div>
        </button>
        <a class="admin-overview__card" href="${getPageHref('inventory')}">
          <div class="admin-overview__card-label">Stock</div>
          <div class="admin-overview__card-title">${stock.out} out · ${stock.low} low</div>
          <div class="admin-overview__card-sub">Open inventory</div>
        </a>
        <div class="admin-overview__card admin-overview__card--static">
          <div class="admin-overview__card-label">Device</div>
          <div class="admin-overview__card-title">${pushOn ? 'Push alerts on' : perm === 'denied' ? 'Notifications blocked' : 'Push not enabled'}</div>
          <div class="admin-overview__card-sub">Manage under Tools</div>
        </div>
      </div>

      <div class="admin-section-head admin-section-head--spaced">
        <div class="admin-section-title">Quick links</div>
        <div class="admin-section-sub">Jump to other POS areas</div>
      </div>
      <div class="admin-quick-links">
        <a class="admin-tool-btn" href="${getPageHref('inventory')}">Inventory</a>
        <a class="admin-tool-btn" href="${getPageHref('clients')}">Clients page</a>
        <a class="admin-tool-btn" href="${getPageHref('delivery')}">Delivery</a>
        <a class="admin-tool-btn" href="${getPageHref('history')}">History</a>
        <a class="admin-tool-btn" href="${getPageHref('analytics')}">Analytics</a>
        <button type="button" class="admin-tool-btn" data-admin-goto="users">Storefront users</button>
        <button type="button" class="admin-tool-btn" data-admin-goto="hours">Hours &amp; busy</button>
        <button type="button" class="admin-tool-btn" data-admin-action="open-orders">Open order stack</button>
      </div>
    </div>`;
}

function toolsHtml() {
  const cartCount = getCart().length;
  const stock = stockSnapshot();
  const waiting = waitingOrdersCount();
  const perm = notificationPermission();
  const prefs = getNotificationPrefs();
  const pushOn = prefs.pushSubscribed && perm === 'granted';
  const pushLabel = pushOn
    ? 'Push alerts on'
    : perm === 'denied'
      ? 'Notifications blocked'
      : 'Enable push alerts';
  return `
    <div class="admin-tools">
      <div class="admin-stat-row admin-stat-row--wide">
        <div class="admin-stat"><span class="admin-stat__n">${storeUsers.length}</span><span class="admin-stat__l">Store users</span></div>
        <div class="admin-stat"><span class="admin-stat__n">${clients.length}</span><span class="admin-stat__l">Clients</span></div>
        <div class="admin-stat"><span class="admin-stat__n">${cartCount}</span><span class="admin-stat__l">Cart lines</span></div>
        <div class="admin-stat"><span class="admin-stat__n">${waiting}</span><span class="admin-stat__l">Waiting</span></div>
      </div>
      <button type="button" class="admin-tool-btn" data-admin-action="enable-push">${escapeHtml(pushLabel)}</button>
      <button type="button" class="admin-tool-btn" data-admin-action="install-pwa" data-pwa-install-item data-pwa-install>Install app</button>
      <button type="button" class="admin-tool-btn" data-admin-action="refresh-users">Refresh user list</button>
      <button type="button" class="admin-tool-btn" data-admin-action="copy-users">Copy storefront users</button>
      <button type="button" class="admin-tool-btn" data-admin-action="export-users">Export users JSON</button>
      <button type="button" class="admin-tool-btn" data-admin-action="copy-clients">Copy clients</button>
      <button type="button" class="admin-tool-btn" data-admin-action="clear-cart">Clear current cart</button>
      <button type="button" class="admin-tool-btn" data-admin-action="open-orders">Open order stack</button>
      <a class="admin-tool-btn" href="${getPageHref('clients')}">Open Clients page</a>
      <a class="admin-tool-btn" href="${getPageHref('inventory')}">Open Inventory${stock.low || stock.out ? ` (${stock.low} low · ${stock.out} out)` : ''}</a>
      <a class="admin-tool-btn" href="${getPageHref('analytics')}">Open Analytics</a>
      <button type="button" class="admin-tool-btn" data-admin-action="reload-data">Reload data from server</button>
    </div>`;
}

const DIAL_MINUTE_STEP = 5;
const DIAL_ITEM_H = 40;
/** @type {WeakMap<HTMLElement, DialColController>} */
const dialColControllers = new WeakMap();

/**
 * @typedef {object} DialColController
 * @property {(value: string, opts?: { animate?: boolean }) => void} setValue
 * @property {() => void} destroy
 */

/** @param {Date} d */
function snapDialMinutes(d) {
  const next = new Date(d.getTime());
  const snapped = Math.round(next.getMinutes() / DIAL_MINUTE_STEP) * DIAL_MINUTE_STEP;
  next.setSeconds(0, 0);
  if (snapped >= 60) {
    next.setHours(next.getHours() + 1, 0, 0, 0);
  } else {
    next.setMinutes(snapped, 0, 0);
  }
  return next;
}

/** Seed dialer from active busy time, else ~30 min from now. */
function dialerSeedDate(status = getFulfillmentStatus()) {
  if (isBusyActive(status) && status.busyUntil) {
    return snapDialMinutes(new Date(status.busyUntil));
  }
  const d = new Date();
  d.setMinutes(d.getMinutes() + 30);
  return snapDialMinutes(d);
}

/** @param {Date} d */
function toDialParts(d) {
  const h24 = d.getHours();
  const minute = d.getMinutes();
  const ampm = h24 >= 12 ? 'pm' : 'am';
  let hour12 = h24 % 12;
  if (hour12 === 0) hour12 = 12;
  return { hour12, minute, ampm, h24 };
}

/** @param {{ hour12: number, minute: number, ampm: string }} parts */
function dialPartsToDate(parts, now = new Date()) {
  let h24 = Number(parts.hour12) % 12;
  if (parts.ampm === 'pm') h24 += 12;
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setHours(h24, Number(parts.minute) || 0, 0, 0);
  // If chosen clock time is not after now, roll to tomorrow.
  if (d.getTime() <= now.getTime() + 30_000) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

function formatDialClock(d) {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatDialDayLabel(d, now = new Date()) {
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const startTomorrow = new Date(startToday);
  startTomorrow.setDate(startTomorrow.getDate() + 1);
  const startDayAfter = new Date(startTomorrow);
  startDayAfter.setDate(startDayAfter.getDate() + 1);
  if (d >= startTomorrow && d < startDayAfter) return 'Tomorrow';
  if (d >= startToday && d < startTomorrow) return 'Today';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function dialWheelHtml(kind, values, selected, formatLabel = (v) => String(v)) {
  const items = values
    .map((v) => {
      const sel = String(v) === String(selected) ? ' is-selected' : '';
      return `<button type="button" class="hours-dial__item${sel}" data-hours-dial-item="${escapeHtml(String(v))}" tabindex="-1">${escapeHtml(formatLabel(v))}</button>`;
    })
    .join('');
  return `
    <div class="hours-dial__col" data-hours-dial-col="${kind}" role="listbox" aria-label="${kind}">
      <div class="hours-dial__track">
        ${items}
      </div>
    </div>`;
}

function hoursStatusCopy() {
  const status = getFulfillmentStatus();
  if (!hoursLoaded) return 'Loading…';
  if (hoursError) return hoursError;

  const parts = [];
  if (isBusyActive(status)) {
    const until = formatBusyUntilLabel(status);
    const who =
      status.busyFor === 'delivery'
        ? 'Delivery'
        : status.busyFor === 'pickup'
          ? 'Pickup'
          : 'Delivery & pickup';
    parts.push(`${who} blocked until ${until || 'later'}`);
  } else if (hasBusyUntil(status)) {
    parts.push('Busy window expired — set a new free time or clear');
  }

  if (!isWithinOpenHours(new Date(), status)) {
    parts.push(`Closed now — opens ${formatUntilClock(nextOpenAt(new Date(), status))}`);
  } else {
    parts.push(`Open ${formatOpenHoursLabel(status)}`);
  }

  return parts.join(' · ');
}

function hoursHtml() {
  const status = getFulfillmentStatus();
  const busy = isBusyActive(status);
  const hasBusy = hasBusyUntil(status);
  const suggestLabel = formatSuggestRangeLabel(status);
  const busyFor = status.busyFor || 'both';
  const suggestStart = status.suggestStart || '';
  const suggestEnd = status.suggestEnd || '';
  const openTime = status.openTime || '07:00';
  const closeTime = status.closeTime || '22:00';
  const withinOpen = isWithinOpenHours(new Date(), status);
  const statusBusy = busy || !withinOpen;
  const seed = dialerSeedDate(status);
  const parts = toDialParts(seed);
  const untilLocal = toDatetimeLocalValue(seed);
  const hours = Array.from({ length: 12 }, (_, i) => i + 1);
  const minutes = Array.from({ length: 60 / DIAL_MINUTE_STEP }, (_, i) => i * DIAL_MINUTE_STEP);
  const padMin = (n) => String(n).padStart(2, '0');

  if (!hoursLoaded && !hoursError) {
    return `<div class="admin-empty">Loading hours…</div>`;
  }

  return `
    <div class="admin-hours">
      <div class="admin-hours__status ${statusBusy ? 'is-busy' : 'is-open'}">
        <div class="admin-hours__status-row">
          <div class="admin-hours__status-label">${busy ? 'Busy' : !withinOpen ? 'Closed' : 'Available'}</div>
          ${
            busy
              ? `<div class="admin-hours__status-until">Free ${escapeHtml(formatBusyUntilLabel(status) || '')}</div>`
              : ''
          }
        </div>
        <div class="admin-hours__status-copy">${escapeHtml(hoursStatusCopy())}</div>
        ${
          suggestLabel
            ? `<div class="admin-hours__status-suggest">Suggesting ${escapeHtml(suggestLabel)}</div>`
            : ''
        }
      </div>

      <section class="admin-hours__hero" aria-label="Busy period">
        <div class="admin-hours__hero-head">
          <div class="admin-hours__hero-title">${busy ? 'Adjust free time' : 'Set when you’re free'}</div>
          <div class="admin-hours__hero-sub">Busy until this time — customers can’t pick earlier slots.</div>
        </div>

        <div
          class="hours-dial"
          data-hours-dial
          data-hour="${parts.hour12}"
          data-minute="${parts.minute}"
          data-ampm="${parts.ampm}"
        >
          <div class="hours-dial__preview">
            <span class="hours-dial__preview-label">Free again</span>
            <span class="hours-dial__preview-time" data-hours-dial-preview>${escapeHtml(formatDialClock(seed))}</span>
            <span class="hours-dial__preview-day" data-hours-dial-day>${escapeHtml(formatDialDayLabel(seed))}</span>
          </div>

          <div class="hours-dial__frame" aria-hidden="false">
            <div class="hours-dial__highlight" aria-hidden="true"></div>
            <div class="hours-dial__wheels">
              ${dialWheelHtml('hour', hours, parts.hour12)}
              <div class="hours-dial__colon" aria-hidden="true">:</div>
              ${dialWheelHtml('minute', minutes, parts.minute, padMin)}
              ${dialWheelHtml('ampm', ['am', 'pm'], parts.ampm, (v) => String(v).toUpperCase())}
            </div>
          </div>

          <input type="hidden" data-hours-busy-until value="${escapeHtml(untilLocal)}" />
        </div>

        <div class="admin-hours__presets" role="group" aria-label="Busy presets">
          <button type="button" class="admin-hours__chip" data-hours-busy-mins="30" ${hoursSaving ? 'disabled' : ''}>30 min</button>
          <button type="button" class="admin-hours__chip" data-hours-busy-mins="60" ${hoursSaving ? 'disabled' : ''}>1 hour</button>
          <button type="button" class="admin-hours__chip" data-hours-busy-mins="120" ${hoursSaving ? 'disabled' : ''}>2 hours</button>
          <button type="button" class="admin-hours__chip" data-hours-busy-mins="180" ${hoursSaving ? 'disabled' : ''}>3 hours</button>
        </div>

        <div class="admin-hours__busy-for" role="group" aria-label="Applies to">
          <button type="button" class="admin-hours__seg ${busyFor === 'both' ? 'is-on' : ''}" data-hours-busy-for-set="both" ${hoursSaving ? 'disabled' : ''}>Both</button>
          <button type="button" class="admin-hours__seg ${busyFor === 'delivery' ? 'is-on' : ''}" data-hours-busy-for-set="delivery" ${hoursSaving ? 'disabled' : ''}>Delivery</button>
          <button type="button" class="admin-hours__seg ${busyFor === 'pickup' ? 'is-on' : ''}" data-hours-busy-for-set="pickup" ${hoursSaving ? 'disabled' : ''}>Pickup</button>
          <input type="hidden" data-hours-busy-for value="${escapeHtml(busyFor)}" />
        </div>

        <div class="admin-hours__hero-actions">
          <button type="button" class="admin-hours__primary" data-hours-action="save-busy" ${hoursSaving ? 'disabled' : ''}>
            ${hoursSaving ? 'Saving…' : busy ? 'Update free time' : 'Set busy until then'}
          </button>
          ${
            hasBusy
              ? `<button type="button" class="admin-hours__secondary" data-hours-action="clear-busy" ${hoursSaving ? 'disabled' : ''}>
                  ${busy ? 'End busy now' : 'Clear expired busy'}
                </button>`
              : ''
          }
        </div>
      </section>

      <details class="admin-hours__more">
        <summary class="admin-hours__more-sum">
          <span>Open hours &amp; suggestions</span>
          <span class="admin-hours__more-meta">${escapeHtml(formatOpenHoursLabel(status))}</span>
        </summary>
        <div class="admin-hours__more-body">
          <div class="admin-hours__block">
            <div class="admin-hours__block-title">Daily open hours</div>
            <div class="admin-hours__block-sub">Storefront blocks times outside this window.</div>
            <div class="admin-hours__range">
              <label class="admin-hours__field">
                <span class="admin-hours__field-label">Opens</span>
                <input type="time" class="admin-hours__input" data-hours-open-time value="${escapeHtml(openTime)}" step="300" ${hoursSaving ? 'disabled' : ''} />
              </label>
              <label class="admin-hours__field">
                <span class="admin-hours__field-label">Closes</span>
                <input type="time" class="admin-hours__input" data-hours-close-time value="${escapeHtml(closeTime)}" step="300" ${hoursSaving ? 'disabled' : ''} />
              </label>
            </div>
            <div class="admin-hours__actions">
              <button type="button" class="admin-tool-btn" data-hours-action="save-open-hours" ${hoursSaving ? 'disabled' : ''}>
                Save open hours
              </button>
            </div>
          </div>

          <div class="admin-hours__block">
            <div class="admin-hours__block-title">Suggested available range</div>
            <div class="admin-hours__block-sub">Optional hint when a chosen time is unavailable.</div>
            <div class="admin-hours__range">
              <label class="admin-hours__field">
                <span class="admin-hours__field-label">From</span>
                <input type="time" class="admin-hours__input" data-hours-suggest-start value="${escapeHtml(suggestStart)}" step="300" ${hoursSaving ? 'disabled' : ''} />
              </label>
              <label class="admin-hours__field">
                <span class="admin-hours__field-label">To</span>
                <input type="time" class="admin-hours__input" data-hours-suggest-end value="${escapeHtml(suggestEnd)}" step="300" ${hoursSaving ? 'disabled' : ''} />
              </label>
            </div>
            <div class="admin-hours__actions">
              <button type="button" class="admin-tool-btn" data-hours-action="save-suggest" ${hoursSaving ? 'disabled' : ''}>
                Save suggested range
              </button>
              <button type="button" class="admin-tool-btn admin-tool-btn--muted" data-hours-action="clear-suggest" ${hoursSaving || (!suggestStart && !suggestEnd) ? 'disabled' : ''}>
                Clear suggestion
              </button>
            </div>
          </div>
        </div>
      </details>
    </div>`;
}

function searchFieldHtml(value, placeholder, attr) {
  return `
    <div class="admin-search">
      <input
        type="search"
        class="admin-search__input"
        ${attr}
        value="${escapeHtml(value)}"
        placeholder="${escapeHtml(placeholder)}"
        autocomplete="off"
        enterkeyhint="search"
      />
      ${value ? `<button type="button" class="admin-search__clear" data-admin-clear-search aria-label="Clear search">✕</button>` : ''}
    </div>`;
}

export function renderAdminPage() {
  const body = document.getElementById('adminBody');
  if (!body) return;
  tabButtonsSync();

  if (activeTab === 'overview') {
    body.innerHTML = `
      <div class="admin-section-head">
        <div class="admin-section-title">Overview</div>
        <div class="admin-section-sub">Status at a glance</div>
      </div>
      ${overviewHtml()}`;
    wireOverviewActions(body);
    wireToolActions(body);
    return;
  }

  if (activeTab === 'users') {
    body.innerHTML = `
      <div class="admin-section-head">
        <div class="admin-section-title">Storefront users</div>
        <div class="admin-section-sub">${storeUsers.length} account${storeUsers.length === 1 ? '' : 's'} · pencil sets a POS-only name</div>
      </div>
      ${searchFieldHtml(usersQuery, 'Search name, phone, code…', 'data-admin-users-search')}
      ${usersListHtml()}`;
    wireUserActions(body);
    wireUsersSearch(body);
    return;
  }

  if (activeTab === 'clients') {
    body.innerHTML = `
      <div class="admin-section-head">
        <div class="admin-section-title">Register clients</div>
        <div class="admin-section-sub">${clients.length} client${clients.length === 1 ? '' : 's'}</div>
      </div>
      ${searchFieldHtml(clientsQuery, 'Search clients…', 'data-admin-clients-search')}
      ${clientsListHtml()}
      <a class="admin-tool-btn admin-tool-btn--spaced" href="${getPageHref('clients')}">Open full Clients page</a>`;
    wireClientActions(body);
    wireClientsSearch(body);
    return;
  }

  if (activeTab === 'hours') {
    body.innerHTML = `
      <div class="admin-section-head">
        <div class="admin-section-title">Hours</div>
        <div class="admin-section-sub">Set when you’re free again</div>
      </div>
      ${hoursHtml()}`;
    wireHoursActions(body);
    return;
  }

  body.innerHTML = `
    <div class="admin-section-head">
      <div class="admin-section-title">Admin tools</div>
      <div class="admin-section-sub">Maintenance shortcuts</div>
    </div>
    ${toolsHtml()}`;
  wireToolActions(body);
}

function readHoursForm(root) {
  syncHoursDialer(root);
  const untilEl = root.querySelector('[data-hours-busy-until]');
  const forEl = root.querySelector('[data-hours-busy-for]');
  const startEl = root.querySelector('[data-hours-suggest-start]');
  const endEl = root.querySelector('[data-hours-suggest-end]');
  const openEl = root.querySelector('[data-hours-open-time]');
  const closeEl = root.querySelector('[data-hours-close-time]');
  const untilRaw = String(untilEl?.value || '').trim();
  /** @type {'both'|'delivery'|'pickup'} */
  const busyForRaw = /** @type {'both'|'delivery'|'pickup'} */ (
    forEl?.value === 'delivery' || forEl?.value === 'pickup' ? forEl.value : 'both'
  );
  return {
    busyUntil: untilRaw ? new Date(untilRaw).toISOString() : null,
    busyFor: busyForRaw,
    suggestStart: toHHmm(startEl?.value) || null,
    suggestEnd: toHHmm(endEl?.value) || null,
    openTime: toHHmm(openEl?.value) || '07:00',
    closeTime: toHHmm(closeEl?.value) || '22:00',
  };
}

function setHoursSavingUi(root, saving) {
  hoursSaving = saving;
  root.querySelectorAll('button, input, select').forEach((el) => {
    if (saving) {
      if (!el.disabled) el.dataset.wasEnabled = '1';
      el.disabled = true;
    } else if (el.dataset.wasEnabled) {
      el.disabled = false;
      delete el.dataset.wasEnabled;
    }
  });
  const busy = isBusyActive();
  root.querySelectorAll('[data-hours-action="save-busy"]').forEach((btn) => {
    btn.textContent = saving ? 'Saving…' : busy ? 'Update free time' : 'Set busy until then';
  });
}

/** @param {HTMLElement} root */
function syncHoursDialer(root) {
  const dial = root.querySelector('[data-hours-dial]');
  if (!dial) return null;
  const hour12 = Number(dial.getAttribute('data-hour') || 12);
  const minute = Number(dial.getAttribute('data-minute') || 0);
  const ampm = dial.getAttribute('data-ampm') === 'pm' ? 'pm' : 'am';
  const date = dialPartsToDate({ hour12, minute, ampm });
  const untilEl = root.querySelector('[data-hours-busy-until]');
  if (untilEl) untilEl.value = toDatetimeLocalValue(date);
  const preview = root.querySelector('[data-hours-dial-preview]');
  const dayEl = root.querySelector('[data-hours-dial-day]');
  if (preview) preview.textContent = formatDialClock(date);
  if (dayEl) dayEl.textContent = formatDialDayLabel(date);
  return date;
}

/** @param {HTMLElement} root @param {Date} date */
function applyDialerDate(root, date, { scroll = true } = {}) {
  const dial = root.querySelector('[data-hours-dial]');
  if (!dial) return;
  const snapped = snapDialMinutes(date);
  const parts = toDialParts(snapped);
  dial.setAttribute('data-hour', String(parts.hour12));
  dial.setAttribute('data-minute', String(parts.minute));
  dial.setAttribute('data-ampm', parts.ampm);
  dial.querySelectorAll('[data-hours-dial-col]').forEach((col) => {
    const kind = col.getAttribute('data-hours-dial-col');
    const want =
      kind === 'hour' ? String(parts.hour12) : kind === 'minute' ? String(parts.minute) : parts.ampm;
    const ctrl = dialColControllers.get(/** @type {HTMLElement} */ (col));
    if (ctrl && scroll) {
      ctrl.setValue(want, { animate: true });
    } else {
      col.querySelectorAll('[data-hours-dial-item]').forEach((item) => {
        item.classList.toggle('is-selected', item.getAttribute('data-hours-dial-item') === want);
      });
    }
  });
  syncHoursDialer(root);
}

/**
 * Transform-based wheel with momentum + spring lock to item centers.
 * @param {HTMLElement} col
 * @param {(value: string) => void} onCommit
 * @param {{ wrap?: boolean, onWrap?: (dir: 1|-1) => void }} [opts]
 * @returns {DialColController}
 */
function createDialColController(col, onCommit, opts = {}) {
  const track = /** @type {HTMLElement|null} */ (col.querySelector('.hours-dial__track'));
  const items = [...col.querySelectorAll('[data-hours-dial-item]')];
  if (!track || !items.length) {
    return { setValue() {}, destroy() {} };
  }

  const wrap = Boolean(opts.wrap);
  const onWrap = opts.onWrap;
  const maxIndex = items.length - 1;
  const cycle = (maxIndex + 1) * DIAL_ITEM_H;
  let index = items.findIndex((el) => el.classList.contains('is-selected'));
  if (index < 0) index = 0;

  let y = 0;
  let v = 0;
  let dragging = false;
  let locked = true;
  let raf = 0;
  let lastT = 0;
  let pointerId = /** @type {number|null} */ (null);
  let lastPointerY = 0;
  let lastMoveT = 0;
  let moved = false;
  let lastCommitted = '';

  // Snappy spring with a short bounce into the lock slot
  const STIFFNESS = 380;
  const DAMPING = 34;
  const FRICTION = 0.952;
  const MIN_FLING = 90;
  const SETTLE_V = 12;
  const SETTLE_X = 0.35;

  const indexToY = (i) => -i * DIAL_ITEM_H;
  const clampIndex = (i) => Math.max(0, Math.min(maxIndex, Math.round(i)));
  const yToIndex = (pos) => clampIndex(-pos / DIAL_ITEM_H);
  const minY = indexToY(maxIndex);
  const maxY = indexToY(0);

  const applyY = () => {
    track.style.transform = `translate3d(0, ${y}px, 0)`;
  };

  const paintSelection = (i) => {
    items.forEach((el, n) => {
      el.classList.toggle('is-selected', n === i);
    });
  };

  const notify = (i) => {
    const value = items[i]?.getAttribute('data-hours-dial-item');
    if (value == null || value === lastCommitted) return;
    lastCommitted = value;
    onCommit(value);
  };

  /** Cross 12→1 or 1→12 and flip AM/PM via onWrap. */
  const applyWrap = () => {
    if (!wrap) return;
    let guard = 0;
    while (y < minY - DIAL_ITEM_H * 0.5 && guard < 4) {
      y += cycle;
      onWrap?.(1);
      guard += 1;
    }
    while (y > maxY + DIAL_ITEM_H * 0.5 && guard < 4) {
      y -= cycle;
      onWrap?.(-1);
      guard += 1;
    }
  };

  const stopRaf = () => {
    if (!raf) return;
    cancelAnimationFrame(raf);
    raf = 0;
  };

  const tick = (now) => {
    const dt = Math.min(0.033, Math.max(0.008, (now - lastT) / 1000));
    lastT = now;

    if (dragging) {
      raf = 0;
      return;
    }

    if (!locked) {
      v *= Math.pow(FRICTION, dt * 60);
      y += v * dt;

      if (wrap) {
        applyWrap();
      } else if (y > maxY) {
        y = maxY + (y - maxY) * 0.28;
        v *= 0.5;
      } else if (y < minY) {
        y = minY + (y - minY) * 0.28;
        v *= 0.5;
      }

      const live = yToIndex(y);
      paintSelection(live);
      notify(live);

      if (Math.abs(v) < MIN_FLING) {
        index = live;
        locked = true;
      }
    }

    if (locked) {
      const targetY = indexToY(index);
      const spring = -STIFFNESS * (y - targetY) - DAMPING * v;
      v += spring * dt;
      y += v * dt;
      paintSelection(index);

      if (Math.abs(v) < SETTLE_V && Math.abs(y - targetY) < SETTLE_X) {
        y = targetY;
        v = 0;
        applyY();
        notify(index);
        raf = 0;
        return;
      }
    }

    applyY();
    raf = requestAnimationFrame(tick);
  };

  const startRaf = () => {
    if (raf) return;
    lastT = performance.now();
    raf = requestAnimationFrame(tick);
  };

  const snapTo = (i, { animate = true } = {}) => {
    if (wrap) {
      // Allow stepping past ends (wheel / programmatic) with AM/PM flip
      let next = i;
      let flips = 0;
      while (next > maxIndex && flips < 4) {
        next -= maxIndex + 1;
        onWrap?.(1);
        flips += 1;
      }
      while (next < 0 && flips < 4) {
        next += maxIndex + 1;
        onWrap?.(-1);
        flips += 1;
      }
      index = clampIndex(next);
    } else {
      index = clampIndex(i);
    }
    locked = true;
    paintSelection(index);
    notify(index);
    if (!animate) {
      stopRaf();
      v = 0;
      y = indexToY(index);
      applyY();
      return;
    }
    startRaf();
  };

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    pointerId = e.pointerId;
    dragging = true;
    locked = false;
    moved = false;
    v = 0;
    stopRaf();
    lastPointerY = e.clientY;
    lastMoveT = performance.now();
    col.classList.add('is-dragging');
    try {
      col.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onPointerMove = (e) => {
    if (pointerId == null || e.pointerId !== pointerId || !dragging) return;
    const now = performance.now();
    const dy = e.clientY - lastPointerY;
    if (Math.abs(dy) > 1.5) moved = true;
    y += dy;

    if (wrap) {
      applyWrap();
    } else if (y > maxY) {
      y = maxY + (y - maxY) * 0.4;
    } else if (y < minY) {
      y = minY + (y - minY) * 0.4;
    }

    const dt = Math.max(1, now - lastMoveT) / 1000;
    const instant = dy / dt;
    v = v * 0.35 + instant * 0.65;
    lastPointerY = e.clientY;
    lastMoveT = now;
    applyY();
    const live = yToIndex(y);
    paintSelection(live);
    notify(live);
  };

  const finishGesture = (e) => {
    if (pointerId == null || e.pointerId !== pointerId) return;
    pointerId = null;
    dragging = false;
    col.classList.remove('is-dragging');

    if (!moved && e.type === 'pointerup') {
      const t = /** @type {Element|null} */ (e.target);
      const btn = t?.closest?.('[data-hours-dial-item]');
      if (btn && col.contains(btn)) {
        const i = items.indexOf(/** @type {HTMLElement} */ (btn));
        if (i >= 0) {
          snapTo(i, { animate: true });
          return;
        }
      }
    }

    if (wrap) applyWrap();
    const coast = Math.max(-2.6, Math.min(2.6, v / -520));
    let next = yToIndex(y) + coast;
    if (wrap) {
      snapTo(next, { animate: true });
      return;
    }
    index = clampIndex(next);
    locked = true;
    paintSelection(index);
    startRaf();
  };

  const onWheel = (e) => {
    e.preventDefault();
    const dir = e.deltaY > 0 ? 1 : -1;
    snapTo(index + dir, { animate: true });
  };

  col.addEventListener('pointerdown', onPointerDown);
  col.addEventListener('pointermove', onPointerMove);
  col.addEventListener('pointerup', finishGesture);
  col.addEventListener('pointercancel', finishGesture);
  col.addEventListener('wheel', onWheel, { passive: false });

  y = indexToY(index);
  applyY();
  paintSelection(index);
  lastCommitted = items[index].getAttribute('data-hours-dial-item') || '';

  return {
    setValue(value, { animate = true } = {}) {
      const i = items.findIndex((el) => el.getAttribute('data-hours-dial-item') === String(value));
      if (i < 0) return;
      // Direct set — do not wrap/flip (presets & sync already know AM/PM)
      index = clampIndex(i);
      locked = true;
      paintSelection(index);
      lastCommitted = String(value);
      onCommit(String(value));
      if (!animate) {
        stopRaf();
        v = 0;
        y = indexToY(index);
        applyY();
        return;
      }
      startRaf();
    },
    destroy() {
      stopRaf();
      col.removeEventListener('pointerdown', onPointerDown);
      col.removeEventListener('pointermove', onPointerMove);
      col.removeEventListener('pointerup', finishGesture);
      col.removeEventListener('pointercancel', finishGesture);
      col.removeEventListener('wheel', onWheel);
      dialColControllers.delete(col);
    },
  };
}

/** @param {HTMLElement} root */
function wireHoursDialer(root) {
  const dial = root.querySelector('[data-hours-dial]');
  if (!dial) return;

  const commitValue = (col, value) => {
    const kind = col.getAttribute('data-hours-dial-col');
    if (!kind || value == null) return;
    if (kind === 'hour') dial.setAttribute('data-hour', value);
    else if (kind === 'minute') dial.setAttribute('data-minute', value);
    else if (kind === 'ampm') dial.setAttribute('data-ampm', value);
    syncHoursDialer(root);
  };

  const flipAmPm = () => {
    const next = dial.getAttribute('data-ampm') === 'pm' ? 'am' : 'pm';
    dial.setAttribute('data-ampm', next);
    const ampmCol = /** @type {HTMLElement|null} */ (root.querySelector('[data-hours-dial-col="ampm"]'));
    const ctrl = ampmCol ? dialColControllers.get(ampmCol) : null;
    if (ctrl) ctrl.setValue(next, { animate: true });
    else commitValue(ampmCol || dial, next);
    syncHoursDialer(root);
  };

  dial.querySelectorAll('[data-hours-dial-col]').forEach((colEl) => {
    const col = /** @type {HTMLElement} */ (colEl);
    const kind = col.getAttribute('data-hours-dial-col');
    const existing = dialColControllers.get(col);
    if (existing) existing.destroy();
    const ctrl = createDialColController(
      col,
      (value) => commitValue(col, value),
      kind === 'hour'
        ? {
            wrap: true,
            onWrap: () => {
              flipAmPm();
            },
          }
        : {},
    );
    dialColControllers.set(col, ctrl);
  });

  syncHoursDialer(root);
}

function wireHoursActions(root) {
  wireHoursDialer(root);

  root.querySelectorAll('[data-hours-busy-for-set]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const value = btn.getAttribute('data-hours-busy-for-set');
      if (value !== 'both' && value !== 'delivery' && value !== 'pickup') return;
      const hidden = root.querySelector('[data-hours-busy-for]');
      if (hidden) hidden.value = value;
      root.querySelectorAll('[data-hours-busy-for-set]').forEach((el) => {
        el.classList.toggle('is-on', el.getAttribute('data-hours-busy-for-set') === value);
      });
    });
  });

  root.querySelectorAll('[data-hours-busy-mins]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const mins = Number(btn.getAttribute('data-hours-busy-mins') || 0);
      const until = new Date(busyUntilFromNow(mins));
      applyDialerDate(root, until);
      const form = readHoursForm(root);
      setHoursSavingUi(root, true);
      try {
        await saveFulfillmentStatus({
          busyUntil: until.toISOString(),
          busyFor: form.busyFor,
        });
        hoursSaving = false;
        showToast(`Busy for the next ${mins >= 60 ? `${mins / 60}h` : `${mins}m`}`);
        renderAdminPage();
      } catch (e) {
        showToast(e?.message || 'Could not save', true);
        setHoursSavingUi(root, false);
      }
    });
  });

  root.querySelectorAll('[data-hours-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-hours-action');
      const form = readHoursForm(root);
      setHoursSavingUi(root, true);
      try {
        if (action === 'save-busy') {
          if (!form.busyUntil || !Number.isFinite(new Date(form.busyUntil).getTime())) {
            throw new Error('Pick a free-again time');
          }
          if (new Date(form.busyUntil).getTime() <= Date.now()) {
            throw new Error('Free time must be in the future');
          }
          await saveFulfillmentStatus({
            busyUntil: form.busyUntil,
            busyFor: form.busyFor,
          });
          showToast(`Busy until ${formatDialClock(new Date(form.busyUntil))}`);
        } else if (action === 'clear-busy') {
          await saveFulfillmentStatus({ busyUntil: null });
          showToast('Busy period ended — open for orders');
        } else if (action === 'save-open-hours') {
          if (!form.openTime || !form.closeTime) {
            throw new Error('Set both open and close times');
          }
          if (form.openTime === form.closeTime) {
            throw new Error('Open and close can’t be the same — that would be 24h; pick a window');
          }
          await saveFulfillmentStatus({
            openTime: form.openTime,
            closeTime: form.closeTime,
          });
          showToast(`Open hours saved · ${formatOpenHoursLabel(getFulfillmentStatus())}`);
        } else if (action === 'save-suggest') {
          if (!form.suggestStart && !form.suggestEnd) {
            throw new Error('Set at least a from or to time');
          }
          await saveFulfillmentStatus({
            suggestStart: form.suggestStart,
            suggestEnd: form.suggestEnd,
          });
          showToast('Suggested range saved');
        } else if (action === 'clear-suggest') {
          await saveFulfillmentStatus({ suggestStart: null, suggestEnd: null });
          showToast('Suggestion cleared');
        }
        hoursSaving = false;
        renderAdminPage();
      } catch (e) {
        showToast(e?.message || 'Could not save', true);
        setHoursSavingUi(root, false);
      }
    });
  });
}

function startRenameStoreUser(id) {
  const user = storeUsers.find((u) => String(u.id) === id);
  const row = document.querySelector(`.admin-user-row[data-user-id="${CSS.escape(id)}"]`);
  if (!user || !row) return;

  const toggle = row.querySelector('.admin-user-row__toggle');
  const nameEl = row.querySelector('.admin-user-row__name');
  if (!toggle || !nameEl) return;

  const current = String(user.pos_display_name || '').trim();
  const snap = String(user.snapchat_name || '').trim();
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'admin-user-row__name-input';
  input.value = current;
  input.placeholder = snap || 'POS display name';
  input.setAttribute('aria-label', 'POS display name');
  input.maxLength = 64;

  nameEl.replaceWith(input);
  toggle.disabled = true;
  input.focus();
  input.select();

  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    if (!commit) {
      renderAdminPage();
      return;
    }
    const next = input.value.trim();
    const prev = String(user.pos_display_name || '').trim();
    if (next === prev) {
      renderAdminPage();
      return;
    }
    try {
      const data = await storeAuth('admin_set_pos_display_name', {
        user_id: id,
        pos_display_name: next,
      });
      usersLoadEpoch += 1;
      const idx = storeUsers.findIndex((u) => String(u.id) === id);
      if (idx > -1) {
        storeUsers[idx] = {
          ...storeUsers[idx],
          pos_display_name: data?.pos_display_name || null,
        };
      }
      upsertPosLabel(
        id,
        data?.snapchat_name || user.snapchat_name,
        data?.pos_display_name || null,
      );
      showToast(next ? 'POS name updated' : 'POS name cleared');
      renderAdminPage();
    } catch (e) {
      showToast(e?.message || 'Could not save POS name', true);
      renderAdminPage();
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void finish(true);
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      void finish(false);
    }
  });
  input.addEventListener('blur', () => {
    void finish(true);
  });
}

function wireUserActions(root) {
  root.querySelectorAll('[data-user-expand]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.admin-user-row');
      const extra = row?.querySelector('.admin-user-row__extra');
      if (!row || !extra) return;
      const open = row.classList.toggle('is-open');
      extra.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });

  root.querySelectorAll('[data-rename-store-user]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-rename-store-user');
      if (!id) return;
      startRenameStoreUser(id);
    });
  });

  root.querySelectorAll('[data-verify-store-user]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-verify-store-user');
      if (!id) return;
      const user = storeUsers.find((u) => String(u.id) === id);
      const currentlyVerified = user
        ? Boolean(user.verified)
        : btn.getAttribute('data-verified') === '1';
      const nextVerified = !currentlyVerified;
      const label = userPosLabel(user);
      const ok = await showConfirm(
        nextVerified
          ? `Verify storefront account ${label}?`
          : `Remove verification from ${label}?`,
      );
      if (!ok) return;
      try {
        const data = await storeAuth('admin_set_verified', {
          user_id: id,
          verified: nextVerified,
        });
        usersLoadEpoch += 1;
        const idx = storeUsers.findIndex((u) => String(u.id) === id);
        if (idx > -1) {
          storeUsers[idx] = {
            ...storeUsers[idx],
            verified: Boolean(data?.verified ?? nextVerified),
            verified_at: data?.verified_at ?? (nextVerified ? new Date().toISOString() : null),
          };
        }
        showToast(nextVerified ? 'Account verified' : 'Verification removed');
        renderAdminPage();
      } catch (e) {
        showToast(e?.message || 'Could not update verification', true);
      }
    });
  });

  root.querySelectorAll('[data-delete-store-user]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-delete-store-user');
      if (!id) return;
      const user = storeUsers.find((u) => String(u.id) === id);
      const label = userPosLabel(user);
      const ok = await showConfirm(`Delete storefront account ${label}? This cannot be undone.`);
      if (!ok) return;
      try {
        await storeAuth('admin_delete_user', { user_id: id });
        usersLoadEpoch += 1;
        storeUsers = storeUsers.filter((u) => String(u.id) !== id);
        showToast('Account deleted');
        renderAdminPage();
      } catch (e) {
        showToast(e?.message || 'Delete failed', true);
      }
    });
  });
}

function wireClientActions(root) {
  root.querySelectorAll('[data-delete-client]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-delete-client');
      if (!id) return;
      const client = clients.find((c) => c.id === id);
      const ok = await showConfirm(
        `Delete client “${client?.name || 'this client'}”? Past sales stay on record without the name.`,
      );
      if (!ok) return;
      try {
        const res = await sbFetch(`clients?id=eq.${id}`, {
          method: 'DELETE',
          headers: { Prefer: 'return=minimal' },
        });
        if (!res.ok) throw new Error(`Supabase ${res.status}`);
        const idx = clients.findIndex((c) => c.id === id);
        if (idx > -1) clients.splice(idx, 1);
        await dataStore.persistCurrent('clients');
        showToast('Client deleted');
        renderAdminPage();
      } catch (e) {
        showToast(e?.message || 'Delete failed', true);
      }
    });
  });
}

function wireSearchInput(root, attr, onQuery) {
  const input = root.querySelector(`[${attr}]`);
  if (!input) return;
  input.addEventListener('input', () => {
    onQuery(String(input.value || ''));
    const start = input.selectionStart;
    const end = input.selectionEnd;
    renderAdminPage();
    const next = document.querySelector(`[${attr}]`);
    if (next) {
      next.focus();
      try {
        next.setSelectionRange(start, end);
      } catch {
        /* ignore */
      }
    }
  });
  root.querySelector('[data-admin-clear-search]')?.addEventListener('click', () => {
    onQuery('');
    renderAdminPage();
    document.querySelector(`[${attr}]`)?.focus();
  });
}

function wireUsersSearch(root) {
  wireSearchInput(root, 'data-admin-users-search', (q) => {
    usersQuery = q;
  });
}

function wireClientsSearch(root) {
  wireSearchInput(root, 'data-admin-clients-search', (q) => {
    clientsQuery = q;
  });
}

function wireOverviewActions(root) {
  root.querySelectorAll('[data-admin-goto]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = /** @type {AdminTab} */ (btn.getAttribute('data-admin-goto') || 'overview');
      setTab(tab);
    });
  });
}

async function copyText(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(okMsg);
  } catch {
    showToast('Could not copy', true);
  }
}

function wireToolActions(root) {
  updateInstallUi();
  root.querySelectorAll('[data-admin-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-admin-action');
      if (action === 'enable-push') {
        const result = await subscribeWebPush({ ordersEnabled: true, schedulesEnabled: true });
        if (result.ok) {
          showToast('Push on — orders alert even when closed');
        } else if (result.reason === 'denied') {
          showToast('Notifications blocked — enable in browser settings', true);
        } else if (result.reason === 'unsupported') {
          showToast('This browser has no Web Push', true);
        } else {
          showToast('Could not enable push', true);
        }
        renderAdminPage();
        return;
      }
      if (action === 'install-pwa') {
        await promptPwaInstall();
        return;
      }
      if (action === 'refresh-users') {
        usersLoaded = false;
        setTab('users');
        await loadStoreUsers();
        renderAdminPage();
        showToast('Users refreshed');
        return;
      }
      if (action === 'copy-users') {
        const lines = storeUsers.map((u, i) => {
          const phone = formatPhone(u);
          const pos = String(u.pos_display_name || '').trim();
          const snap = u.snapchat_name || 'user';
          const label = pos ? `${pos} (${snap})` : snap;
          const referredBy = u.referred_by_name
            ? ` · referred by ${u.referred_by_name}`
            : '';
          return `${i + 1}. ${label}${phone ? ` · ${phone}` : ''}${u.location_label ? ` · ${u.location_label}` : ''}${u.referral_code ? ` · ${u.referral_code}` : ''}${referredBy}`;
        });
        await copyText(lines.join('\n') || 'No users', 'Users copied');
        return;
      }
      if (action === 'export-users') {
        const payload = JSON.stringify(storeUsers, null, 2);
        await copyText(payload || '[]', 'Users JSON copied');
        return;
      }
      if (action === 'copy-clients') {
        const lines = [...clients]
          .sort((a, b) => String(a.name).localeCompare(String(b.name)))
          .map((c, i) => `${i + 1}. ${c.name}`);
        await copyText(lines.join('\n') || 'No clients', 'Clients copied');
        return;
      }
      if (action === 'clear-cart') {
        const ok = await showConfirm('Clear the current cart and order details?');
        if (!ok) return;
        setCart([]);
        setOrderMeta({
          clientName: '',
          clientId: '',
          isCredit: false,
          clientPhone: '',
          deliveryTimeLabel: '',
          deliveryTimeMode: '',
          deliveryDeliverAt: '',
          storeOrderId: '',
        });
        resetDraftStock();
        const { updateFabBadge } = await import('./orders.js');
        updateFabBadge();
        showToast('Cart cleared');
        renderAdminPage();
        return;
      }
      if (action === 'open-orders') {
        openStoreOrdersPanel();
        return;
      }
      if (action === 'reload-data') {
        const ok = await showConfirm('Reload all POS data from the server? The page will refresh.');
        if (!ok) return;
        try {
          await dataStore.recoverFromServer();
          showToast('Data reloaded');
          location.reload();
        } catch (e) {
          showToast(e?.message || 'Reload failed', true);
        }
      }
    });
  });
}

/**
 * Soft-nav return / popstate — align in-memory tab with the URL hash.
 * Paint is handled by activatePage after this hook.
 */
export function onAdminActivate() {
  const next = tabFromHash();
  if (next !== activeTab) {
    activeTab = next;
  }
  // Keep URL hash in sync when returning via a bare admin.html link.
  if (!location.hash) {
    history.replaceState(null, '', `${location.pathname}${location.search}#${activeTab}`);
  }
}

/**
 * Boot the dedicated admin page (tabs + body live in pages/admin.html).
 */
export function wireAdminPage() {
  if (pageWired) return;
  pageWired = true;

  activeTab = tabFromHash();
  if (!location.hash) {
    history.replaceState(null, '', `${location.pathname}${location.search}#${activeTab}`);
  }
  document.querySelectorAll('[data-admin-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = /** @type {AdminTab} */ (btn.getAttribute('data-admin-tab') || 'overview');
      setTab(tab);
    });
  });

  window.addEventListener('hashchange', () => {
    const next = tabFromHash();
    if (next !== activeTab) setTab(next, { syncHash: false });
  });

  void Promise.all([loadStoreUsers(), loadHours()]).then(() => {
    renderAdminPage();
  });

  onStoreOrdersChange(() => {
    if (!pageWired) return;
    if (activeTab === 'overview' || activeTab === 'tools') {
      renderAdminPage();
    }
  });
}

/** Kept for mountApp — admin icon is now a link in layout; no modal. */
export function wireAdminPanel() {
  // no-op: #adminBtn is an <a href> to the admin page
}
