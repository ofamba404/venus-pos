/**
 * POS admin panel — storefront users, register clients, and maintenance tools.
 * Icon sits next to the debug (spanner) button in the header.
 */

import { closeModal, openModal } from './animations.js';
import { SUPABASE_ANON_JWT, SUPABASE_URL, getPageHref } from './config.js';
import { sbFetch } from './api.js';
import {
  getCart,
  clients,
  resetDraftStock,
  setCart,
  setOrderMeta,
} from './state.js';
import { escapeHtml, showConfirm, showToast } from './utils.js';
import { dataStore } from './store/index.js';

const STORE_AUTH_URL = `${SUPABASE_URL}/functions/v1/store-auth`;

/** @typedef {'users' | 'clients' | 'tools'} AdminTab */

/** @type {AdminTab} */
let activeTab = 'users';
/** @type {Array<Record<string, unknown>>} */
let storeUsers = [];
let usersLoaded = false;
let usersError = '';

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

async function storeAuth(action, body = {}) {
  const res = await fetch(STORE_AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_JWT,
      Authorization: `Bearer ${SUPABASE_ANON_JWT}`,
    },
    body: JSON.stringify({ action, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

async function loadStoreUsers() {
  usersError = '';
  try {
    const data = await storeAuth('admin_list_users');
    storeUsers = Array.isArray(data.users) ? data.users : [];
    usersLoaded = true;
  } catch (e) {
    usersError = e?.message || 'Could not load storefront users';
    storeUsers = [];
    usersLoaded = true;
  }
}

function ensureAdminOverlay() {
  let overlay = document.getElementById('adminOverlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'adminOverlay';
  overlay.className = 'modal-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="modal admin-modal" id="adminModalBody" role="dialog" aria-modal="true" aria-labelledby="adminModalTitle">
      <div class="modal-header admin-modal__header">
        <div class="modal-title" id="adminModalTitle">Admin</div>
        <button class="modal-close" id="adminCloseBtn" type="button" aria-label="Close admin">✕</button>
      </div>
      <div class="admin-tabs" role="tablist" aria-label="Admin sections">
        <button type="button" class="admin-tab is-active" data-admin-tab="users" role="tab" aria-selected="true">Users</button>
        <button type="button" class="admin-tab" data-admin-tab="clients" role="tab" aria-selected="false">Clients</button>
        <button type="button" class="admin-tab" data-admin-tab="tools" role="tab" aria-selected="false">Tools</button>
      </div>
      <div class="admin-body" id="adminBody"></div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal(overlay);
  });
  overlay.querySelector('#adminCloseBtn')?.addEventListener('click', () => closeModal(overlay));
  overlay.querySelectorAll('[data-admin-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = /** @type {AdminTab} */ (btn.getAttribute('data-admin-tab') || 'users');
      renderAdminBody();
    });
  });

  return overlay;
}

function ensureAdminButton() {
  let btn = document.getElementById('adminBtn');
  if (btn) return btn;

  const actions = document.querySelector('.header-actions');
  const debugBtn = document.getElementById('debugBtn');
  if (!actions || !debugBtn) return null;

  btn = document.createElement('button');
  btn.className = 'icon-btn';
  btn.id = 'adminBtn';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Admin panel');
  btn.title = 'Admin';
  btn.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3z"/>
      <path d="M9.5 12l1.8 1.8L15 10"/>
    </svg>`;
  actions.insertBefore(btn, debugBtn);
  return btn;
}

function tabButtonsSync() {
  document.querySelectorAll('[data-admin-tab]').forEach((btn) => {
    const on = btn.getAttribute('data-admin-tab') === activeTab;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

function usersListHtml() {
  if (!usersLoaded) {
    return `<div class="admin-empty">Loading storefront users…</div>`;
  }
  if (usersError) {
    return `<div class="admin-empty admin-empty--error">${escapeHtml(usersError)}</div>`;
  }
  if (!storeUsers.length) {
    return `<div class="admin-empty">No storefront accounts yet</div>`;
  }

  return `
    <ol class="admin-user-list">
      ${storeUsers
        .map((user, index) => {
          const name = String(user.snapchat_name || 'User').trim() || 'User';
          const phone = formatPhone(user);
          const location = String(user.location_label || '').trim();
          const created = formatDate(user.created_at);
          const referral = String(user.referral_code || '').trim();
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
                  ${phone ? `<span>${escapeHtml(phone)}</span>` : ''}
                  ${location ? `<span>${escapeHtml(location)}</span>` : ''}
                  ${created ? `<span>${escapeHtml(created)}</span>` : ''}
                  ${referral ? `<span>${escapeHtml(referral)}</span>` : ''}
                  ${referredBy ? `<span>${escapeHtml(referredBy)}</span>` : ''}
                </div>
              </div>
              <button type="button" class="admin-user-row__delete" data-delete-store-user="${escapeHtml(String(user.id || ''))}" title="Delete account">Delete</button>
            </li>`;
        })
        .join('')}
    </ol>`;
}

function clientsListHtml() {
  const list = [...clients].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  if (!list.length) {
    return `<div class="admin-empty">No register clients yet</div>`;
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

function toolsHtml() {
  const cartCount = getCart().length;
  return `
    <div class="admin-tools">
      <div class="admin-stat-row">
        <div class="admin-stat"><span class="admin-stat__n">${storeUsers.length}</span><span class="admin-stat__l">Store users</span></div>
        <div class="admin-stat"><span class="admin-stat__n">${clients.length}</span><span class="admin-stat__l">Clients</span></div>
        <div class="admin-stat"><span class="admin-stat__n">${cartCount}</span><span class="admin-stat__l">Cart lines</span></div>
      </div>
      <button type="button" class="admin-tool-btn" data-admin-action="refresh-users">Refresh user list</button>
      <button type="button" class="admin-tool-btn" data-admin-action="copy-users">Copy storefront users</button>
      <button type="button" class="admin-tool-btn" data-admin-action="copy-clients">Copy clients</button>
      <button type="button" class="admin-tool-btn" data-admin-action="clear-cart">Clear current cart</button>
      <button type="button" class="admin-tool-btn" data-admin-action="open-orders">Open order stack</button>
      <button type="button" class="admin-tool-btn" data-admin-action="open-clients">Open Clients page</button>
      <button type="button" class="admin-tool-btn" data-admin-action="reload-data">Reload data from server</button>
    </div>`;
}

function renderAdminBody() {
  const body = document.getElementById('adminBody');
  if (!body) return;
  tabButtonsSync();

  if (activeTab === 'users') {
    body.innerHTML = `
      <div class="admin-section-head">
        <div class="admin-section-title">Storefront users</div>
        <div class="admin-section-sub">${storeUsers.length} account${storeUsers.length === 1 ? '' : 's'}</div>
      </div>
      ${usersListHtml()}`;
    wireUserActions(body);
    return;
  }

  if (activeTab === 'clients') {
    body.innerHTML = `
      <div class="admin-section-head">
        <div class="admin-section-title">Register clients</div>
        <div class="admin-section-sub">${clients.length} client${clients.length === 1 ? '' : 's'}</div>
      </div>
      ${clientsListHtml()}`;
    wireClientActions(body);
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
        storeUsers = storeUsers.filter((u) => String(u.id) !== id);
        showToast('Account deleted');
        renderAdminBody();
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
        renderAdminBody();
      } catch (e) {
        showToast(e?.message || 'Delete failed', true);
      }
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
  root.querySelectorAll('[data-admin-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-admin-action');
      if (action === 'refresh-users') {
        usersLoaded = false;
        renderAdminBody();
        await loadStoreUsers();
        activeTab = 'users';
        renderAdminBody();
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
        renderAdminBody();
        return;
      }
      if (action === 'open-orders') {
        closeModal(document.getElementById('adminOverlay'));
        location.hash = '#store-orders';
        return;
      }
      if (action === 'open-clients') {
        location.href = getPageHref('clients');
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

async function openAdminPanel() {
  const overlay = ensureAdminOverlay();
  activeTab = 'users';
  usersLoaded = false;
  renderAdminBody();
  openModal(overlay);
  await loadStoreUsers();
  if (activeTab === 'users') renderAdminBody();
}

export function wireAdminPanel() {
  ensureAdminOverlay();
  const btn = ensureAdminButton();
  if (btn && !btn.dataset.wired) {
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
      void openAdminPanel();
    });
  }
}
