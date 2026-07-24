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
    const phone = formatPhone(user).toLowerCase();
    const referral = String(user.referral_code || '').toLowerCase();
    const location = String(user.location_label || '').toLowerCase();
    const referred = String(user.referred_by_name || user.referred_by_code || '').toLowerCase();
    return (
      name.includes(q) ||
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
          const name = String(user.snapchat_name || 'User').trim() || 'User';
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
          return `
            <li class="admin-user-row" data-user-id="${escapeHtml(String(user.id || ''))}">
              <div class="admin-user-row__index">${index + 1}</div>
              <div class="admin-user-row__main">
                <div class="admin-user-row__name">${escapeHtml(name)}</div>
                <div class="admin-user-row__meta">
                  ${created ? `<span>${escapeHtml(created)}</span>` : ''}
                  ${phone ? `<span>${escapeHtml(phone)}</span>` : ''}
                  ${location ? `<span>${escapeHtml(location)}</span>` : ''}
                  ${referral ? `<span>${escapeHtml(referral)}</span>` : ''}
                  ${referredBy ? `<span class="admin-user-row__referred">${escapeHtml(referredBy)}</span>` : ''}
                </div>
              </div>
              <button type="button" class="admin-user-row__delete" data-delete-store-user="${escapeHtml(String(user.id || ''))}" title="Delete account">Delete</button>
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
            <div class="admin-user-row__meta">
              ${client.created_at ? `<span>${escapeHtml(formatDate(client.created_at))}</span>` : ''}
            </div>
          </div>
          <button type="button" class="admin-user-row__delete" data-delete-client="${escapeHtml(client.id)}" title="Delete client">Delete</button>
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
    parts.push('Busy window expired — clear or set a new time');
  }

  if (!isWithinOpenHours(new Date(), status)) {
    parts.push(`Closed now — opens ${formatUntilClock(nextOpenAt(new Date(), status))}`);
  } else {
    parts.push(`Open hours ${formatOpenHoursLabel(status)}`);
  }

  return parts.join(' · ');
}

function hoursHtml() {
  const status = getFulfillmentStatus();
  const busy = isBusyActive(status);
  const hasBusy = hasBusyUntil(status);
  const suggestLabel = formatSuggestRangeLabel(status);
  const untilLocal = hasBusy ? toDatetimeLocalValue(status.busyUntil) : '';
  const busyFor = status.busyFor || 'both';
  const suggestStart = status.suggestStart || '';
  const suggestEnd = status.suggestEnd || '';
  const openTime = status.openTime || '07:00';
  const closeTime = status.closeTime || '22:00';
  const statusBusy = busy || !isWithinOpenHours(new Date(), status);

  if (!hoursLoaded && !hoursError) {
    return `<div class="admin-empty">Loading hours…</div>`;
  }

  return `
    <div class="admin-hours">
      <div class="admin-hours__status ${statusBusy ? 'is-busy' : 'is-open'}">
        <div class="admin-hours__status-label">${busy ? 'Busy' : statusBusy ? 'Closed' : 'Available'}</div>
        <div class="admin-hours__status-copy">${escapeHtml(hoursStatusCopy())}</div>
        ${
          suggestLabel
            ? `<div class="admin-hours__status-suggest">Suggesting ${escapeHtml(suggestLabel)}</div>`
            : ''
        }
        ${
          hasBusy
            ? `<button type="button" class="admin-tool-btn admin-hours__clear-busy" data-hours-action="clear-busy" ${hoursSaving ? 'disabled' : ''}>
                ${busy ? 'End busy period' : 'Remove expired busy time'}
              </button>`
            : ''
        }
      </div>

      <div class="admin-hours__block">
        <div class="admin-hours__block-title">Daily open hours</div>
        <div class="admin-hours__block-sub">Storefront blocks any time outside this window (default closed 10:00 PM – 7:00 AM).</div>
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
        <div class="admin-hours__block-title">Mark busy</div>
        <div class="admin-hours__block-sub">Hides Right now / In 30 min / In 1 hour when they fall inside this window. Customers can only pick a later time.</div>
        <div class="admin-hours__presets" role="group" aria-label="Busy presets">
          <button type="button" class="admin-hours__chip" data-hours-busy-mins="30" ${hoursSaving ? 'disabled' : ''}>30 min</button>
          <button type="button" class="admin-hours__chip" data-hours-busy-mins="60" ${hoursSaving ? 'disabled' : ''}>1 hour</button>
          <button type="button" class="admin-hours__chip" data-hours-busy-mins="120" ${hoursSaving ? 'disabled' : ''}>2 hours</button>
          <button type="button" class="admin-hours__chip" data-hours-busy-mins="180" ${hoursSaving ? 'disabled' : ''}>3 hours</button>
        </div>
        <label class="admin-hours__field">
          <span class="admin-hours__field-label">Busy until</span>
          <input
            type="datetime-local"
            class="admin-hours__input"
            data-hours-busy-until
            value="${escapeHtml(untilLocal)}"
            ${hoursSaving ? 'disabled' : ''}
          />
        </label>
        <label class="admin-hours__field">
          <span class="admin-hours__field-label">Applies to</span>
          <select class="admin-hours__input" data-hours-busy-for ${hoursSaving ? 'disabled' : ''}>
            <option value="both" ${busyFor === 'both' ? 'selected' : ''}>Delivery &amp; pickup</option>
            <option value="delivery" ${busyFor === 'delivery' ? 'selected' : ''}>Delivery only</option>
            <option value="pickup" ${busyFor === 'pickup' ? 'selected' : ''}>Pickup only</option>
          </select>
        </label>
        <div class="admin-hours__actions">
          <button type="button" class="admin-tool-btn" data-hours-action="save-busy" ${hoursSaving ? 'disabled' : ''}>
            ${hoursSaving ? 'Saving…' : hasBusy ? 'Update busy window' : 'Save busy window'}
          </button>
          <button type="button" class="admin-tool-btn admin-tool-btn--muted" data-hours-action="clear-busy" ${hoursSaving || !hasBusy ? 'disabled' : ''}>
            End busy period
          </button>
        </div>
      </div>

      <div class="admin-hours__block">
        <div class="admin-hours__block-title">Suggested available range</div>
        <div class="admin-hours__block-sub">Optional hint when a chosen time is unavailable — e.g. “Try 4:00 – 7:00 PM”.</div>
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
        <div class="admin-section-sub">${storeUsers.length} account${storeUsers.length === 1 ? '' : 's'}</div>
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
        <div class="admin-section-title">Pickup &amp; delivery</div>
        <div class="admin-section-sub">Busy times for the storefront</div>
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
  root.querySelectorAll('[data-hours-action="save-busy"]').forEach((btn) => {
    btn.textContent = saving ? 'Saving…' : hasBusyUntil() ? 'Update busy window' : 'Save busy window';
  });
}

function wireHoursActions(root) {
  root.querySelectorAll('[data-hours-busy-mins]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const mins = Number(btn.getAttribute('data-hours-busy-mins') || 0);
      const form = readHoursForm(root);
      setHoursSavingUi(root, true);
      try {
        await saveFulfillmentStatus({
          busyUntil: busyUntilFromNow(mins),
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
            throw new Error('Pick a busy-until time');
          }
          if (new Date(form.busyUntil).getTime() <= Date.now()) {
            throw new Error('Busy until must be in the future');
          }
          await saveFulfillmentStatus({
            busyUntil: form.busyUntil,
            busyFor: form.busyFor,
          });
          showToast('Busy window saved — blocked slots hide on storefront');
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

function wireUserActions(root) {
  root.querySelectorAll('[data-delete-store-user]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-delete-store-user');
      if (!id) return;
      const user = storeUsers.find((u) => String(u.id) === id);
      const label = user?.snapchat_name ? user.snapchat_name : 'this account';
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
          const referredBy = u.referred_by_name
            ? ` · referred by ${u.referred_by_name}`
            : '';
          return `${i + 1}. ${u.snapchat_name || 'user'}${phone ? ` · ${phone}` : ''}${u.location_label ? ` · ${u.location_label}` : ''}${u.referral_code ? ` · ${u.referral_code}` : ''}${referredBy}`;
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
