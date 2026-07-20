/**
 * Incoming storefront order queue — Realtime + light fallback poll.
 * Cart lines from the store do not reserve draft stock; inventory deducts on Checkout only.
 */

import { sbFetch } from './api.js';
import { PRODUCTS } from './config.js';
import { notifyOrderCancelled, notifyStorefrontOrder } from './notifications.js';
import {
  applyStorefrontOrderToCart,
  openLoadedOrderModal,
  getActiveStoreOrderId,
  captureStoreOrderSession,
  captureComposeDraft,
  hasStoreOrderSession,
  restoreStoreOrderSession,
  dropStoreOrderSession,
  updateFabBadge,
} from './orders.js';
import { getRealtimeClient } from './realtime-client.js';
import { escapeHtml, fmtUGX, showConfirm, showToast } from './utils.js';

/** Safety-net poll when Realtime is down or a change was missed. */
const FALLBACK_POLL_MS = 30_000;
const ACTIVE_STATUSES = new Set(['pending', 'confirmed', 'accepted', 'cancelled']);
/** Storefront PWA push endpoint — notifies the customer when staff confirms. */
const STORE_PUSH_NOTIFY_URL = 'https://venus-store.netlify.app/api/push/notify';
/** Order ids cancelled from this POS session — skip “customer cancelled” toast. */
const staffCancelledIds = new Set();

/**
 * Push a closed-browser notification to the customer's storefront PWA.
 * @param {object} order
 * @param {'confirmed' | 'cancelled'} kind
 */
async function notifyStoreCustomerPush(order, kind) {
  const customerKey = String(order?.customer_name || '').trim().toLowerCase();
  if (!customerKey || !order?.id) return;
  const payloads = {
    confirmed: {
      type: 'order-confirmed',
      title: 'Order confirmed',
      body: 'Venus confirmed your order. We’re on it.',
      requireInteraction: true,
    },
    cancelled: {
      type: 'order-cancelled',
      title: 'Order cancelled',
      body: 'Your order was cancelled.',
      requireInteraction: false,
    },
  };
  const payload = payloads[kind];
  if (!payload) return;
  try {
    await fetch(STORE_PUSH_NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerKey,
        ...payload,
        url: '/',
        tag: `${payload.type}-${order.id}`,
      }),
    });
  } catch (err) {
    console.warn('store customer push failed', err);
  }
}

/** @type {Map<string, object>} */
const orderCache = new Map();
/** @type {Set<string>} */
const seenIds = new Set();
/** @type {Set<string>} */
const notifiedIds = new Set();
/** @type {ReturnType<typeof setInterval> | null} */
let pollTimer = null;
/** @type {{ unsubscribe?: () => void } | null} */
let realtimeChannel = null;
let panelOpen = false;
let bootstrapped = false;
let realtimeLive = false;
/** Ignore the bag-button click that follows an outside-dismiss pointerdown. */
let ignoreNextBagToggle = false;

function storeOrdersHashActive() {
  return location.hash === '#store-orders';
}

/** Drop `#store-orders` so a refresh does not reopen the panel. */
function clearStoreOrdersHash() {
  if (!storeOrdersHashActive()) return;
  history.replaceState(null, '', `${location.pathname}${location.search}`);
}

/** Open or close the order stack (URL hash is deep-link only, not sticky state). */
export function setStoreOrdersPanelOpen(open) {
  const next = !!open;
  if (panelOpen === next) {
    const panel = document.getElementById('storeOrdersPanel');
    if (next && panel?.hidden) renderStoreOrderUi();
    if (!next) clearStoreOrdersHash();
    return;
  }
  panelOpen = next;
  if (!next) clearStoreOrdersHash();
  renderStoreOrderUi();
}

export function openStoreOrdersPanel() {
  setStoreOrdersPanelOpen(true);
}

export function closeStoreOrdersPanel() {
  setStoreOrdersPanelOpen(false);
}

/** Open from `#store-orders`, then clear the hash so refresh stays closed. */
function consumeStoreOrdersHash() {
  if (!storeOrdersHashActive()) return;
  panelOpen = true;
  clearStoreOrdersHash();
  renderStoreOrderUi();
}

/** In-flight / optimistic dismissals — survives poll races until DB confirms dismissed_at. */
const dismissingIds = new Set();

/** Cancelled orders stay in the stack until staff dismisses (dismissed_at set). */
function isStackVisible(order) {
  if (!order || !ACTIVE_STATUSES.has(order.status)) return false;
  if (dismissingIds.has(order.id)) return false;
  if (order.status === 'cancelled' && order.dismissed_at) return false;
  return true;
}

export function getStoreOrderCache() {
  return [...orderCache.values()].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

window.__venusStoreOrderCacheGet = (id) => orderCache.get(id) || null;

export function getStackedStoreOrders() {
  return getStoreOrderCache().filter(isStackVisible);
}

function waitingStoreOrderCount() {
  // Header badge: still need staff to load these into a cart.
  return getStackedStoreOrders().filter(
    (o) => o.status === 'pending' || o.status === 'confirmed',
  ).length;
}

/** Accepted in DB = loaded into a POS cart (survives refresh). */
export function loadedStoreOrderCount() {
  return getStackedStoreOrders().filter((o) => o.status === 'accepted').length;
}

function cancelledVisibleCount() {
  return getStackedStoreOrders().filter((o) => o.status === 'cancelled').length;
}

function deliveryLabel(order) {
  if (order.delivery_enabled === false) return 'Pickup';
  const d = order.delivery && typeof order.delivery === 'object' ? order.delivery : {};
  return String(d.label || d.mode || 'Delivery').trim() || 'Delivery';
}

function orderTimeLabel(order) {
  const raw = order?.created_at;
  if (!raw) return '';
  const t = new Date(raw);
  if (Number.isNaN(t.getTime())) return '';
  return t.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function orderTitle(order) {
  return String(order.customer_name || '').trim() || 'Storefront order';
}

async function fetchOpenOrders() {
  // Open orders + cancelled that staff have not dismissed yet.
  const res = await sbFetch(
    'store_orders?or=(status.in.(pending,confirmed,accepted),and(status.eq.cancelled,dismissed_at.is.null))&order=created_at.desc&limit=40',
  );
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

export async function markStoreOrderConfirmed(orderId) {
  if (!orderId) return;
  const now = new Date().toISOString();
  const cached = orderCache.get(orderId);
  // Keep accepted/checked_out when confirming from the review cart after load.
  const keepStatus =
    cached?.status === 'accepted' || cached?.status === 'checked_out' ? cached.status : 'confirmed';
  const res = await sbFetch(`store_orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: keepStatus,
      confirmed_at: now,
      updated_at: now,
    }),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  if (cached && cached.status !== 'cancelled') {
    cached.status = keepStatus;
    cached.confirmed_at = now;
    cached.updated_at = now;
    orderCache.set(orderId, cached);
  }
  renderStoreOrderUi();
  void notifyStoreCustomerPush(cached || { id: orderId }, 'confirmed');
}

export async function markStoreOrderAccepted(orderId) {
  if (!orderId) return;
  const now = new Date().toISOString();
  const body = {
    status: 'accepted',
    accepted_at: now,
    updated_at: now,
  };
  const cached = orderCache.get(orderId);
  // Confirmation is explicit in the review cart — loading does not notify the customer.
  const res = await sbFetch(`store_orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  if (cached && cached.status !== 'cancelled') {
    cached.status = 'accepted';
    cached.accepted_at = now;
    cached.updated_at = now;
    orderCache.set(orderId, cached);
  }
  renderStoreOrderUi();
}

/**
 * Staff cleared the order from the cart without checkout — put it back in the waiting stack.
 */
export async function releaseStoreOrderFromCart(orderId) {
  const id = String(orderId || '');
  if (!id) return;
  dropStoreOrderSession(id);

  const cached = orderCache.get(id);
  if (!cached || cached.status !== 'accepted') {
    renderStoreOrderUi();
    return;
  }

  const now = new Date().toISOString();
  const status = cached.confirmed_at ? 'confirmed' : 'pending';
  try {
    const res = await sbFetch(`store_orders?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status,
        accepted_at: null,
        updated_at: now,
      }),
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    cached.status = status;
    cached.accepted_at = null;
    cached.updated_at = now;
    orderCache.set(id, cached);
  } catch (e) {
    console.error('release store order failed', e);
  }
  renderStoreOrderUi();
}

export async function markStoreOrderCheckedOut(orderId, saleId = null) {
  if (!orderId) return;
  const now = new Date().toISOString();
  const body = {
    status: 'checked_out',
    checked_out_at: now,
    updated_at: now,
  };
  if (saleId) body.sale_id = saleId;
  const res = await sbFetch(`store_orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  orderCache.delete(orderId);
  dismissingIds.delete(orderId);
  dropStoreOrderSession(orderId);
  renderStoreOrderUi();
}

export async function markStoreOrderCancelled(orderId) {
  if (!orderId) return;
  const now = new Date().toISOString();
  const res = await sbFetch(`store_orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'cancelled',
      cancelled_at: now,
      updated_at: now,
    }),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  const cached = orderCache.get(orderId);
  if (cached) {
    cached.status = 'cancelled';
    cached.cancelled_at = now;
    cached.updated_at = now;
    orderCache.set(orderId, cached);
  }
  renderStoreOrderUi();
  void notifyStoreCustomerPush(cached || { id: orderId }, 'cancelled');
}

async function dismissOrder(orderId) {
  const id = String(orderId || '');
  if (!id) return;

  dismissingIds.add(id);

  const panel = document.getElementById('storeOrdersPanel');
  const listEl = panel?.querySelector('.store-orders-panel__list');
  listEl?.querySelector(`[data-store-order-id="${CSS.escape(id)}"]`)?.remove();

  const stacked = getStackedStoreOrders();
  if (listEl) {
    listEl.dataset.sig = stackListSignature(stacked);
    if (!stacked.length) listEl.innerHTML = stackEmptyHtml();
  }

  // Badge + header only — list already matches after the row remove.
  renderStoreOrderUi();

  const now = new Date().toISOString();
  try {
    const res = await sbFetch(`store_orders?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        dismissed_at: now,
        updated_at: now,
      }),
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    const cached = orderCache.get(id);
    if (cached) {
      cached.dismissed_at = now;
      cached.updated_at = now;
      orderCache.set(id, cached);
    }
    orderCache.delete(id);
    dismissingIds.delete(id);
  } catch (e) {
    console.error('dismiss store order failed', e);
    dismissingIds.delete(id);
    showToast('Could not dismiss order', true);
    renderStoreOrderUi();
    return;
  }
  renderStoreOrderUi();
}

/**
 * Apply one order row (Realtime or poll). Does not wipe unrelated cache entries.
 * @param {object} row
 * @param {{ announce?: boolean }} [opts]
 */
function upsertOrder(row, { announce = true } = {}) {
  if (!row?.id) return;
  const prev = orderCache.get(row.id);

  if (!ACTIVE_STATUSES.has(row.status) || (row.status === 'cancelled' && row.dismissed_at)) {
    orderCache.delete(row.id);
    dismissingIds.delete(row.id);
    dropStoreOrderSession(row.id);
    return;
  }

  orderCache.set(row.id, row);

  if (!bootstrapped || !announce) {
    seenIds.add(row.id);
    return;
  }

  if (!seenIds.has(row.id) && row.status === 'pending') {
    seenIds.add(row.id);
    if (!notifiedIds.has(row.id)) {
      notifiedIds.add(row.id);
      void notifyStorefrontOrder({
        orderId: row.id,
        customerName: orderTitle(row),
        totalLabel: fmtUGX(row.subtotal_ugx || 0),
        itemCount: row.item_count || (Array.isArray(row.items) ? row.items.length : 0),
        url: `${location.pathname}${location.search}#store-orders`,
      });
    }
  } else if (prev && prev.status !== 'cancelled' && row.status === 'cancelled') {
    dropStoreOrderSession(row.id);
    const byStaff = staffCancelledIds.has(row.id);
    if (byStaff) {
      staffCancelledIds.delete(row.id);
      // Staff cancel already toasted + notified the open cart from cancelStoreOrder.
    } else {
      showToast(`${orderTitle(row)} cancelled the order`, true);
      void notifyOrderCancelled({
        orderId: row.id,
        customerName: orderTitle(row),
        url: `${location.pathname}${location.search}#store-orders`,
      });
      if (getActiveStoreOrderId() === row.id) {
        document.dispatchEvent(
          new CustomEvent('store-order:cancelled', {
            detail: { orderId: row.id, byStaff: false },
          }),
        );
      }
    }
  } else {
    seenIds.add(row.id);
  }
}

function mergeOrders(rows) {
  const nextIds = new Set();
  for (const row of rows || []) {
    if (!row?.id) continue;
    nextIds.add(row.id);
    upsertOrder(row, { announce: bootstrapped });
  }

  for (const id of [...orderCache.keys()]) {
    if (!nextIds.has(id)) orderCache.delete(id);
  }
}

function handleRealtimePayload(payload) {
  const eventType = payload?.eventType || payload?.event;
  const row = payload?.new?.id ? payload.new : payload?.old;

  if (eventType === 'DELETE') {
    if (row?.id) orderCache.delete(row.id);
    renderStoreOrderUi();
    return;
  }

  if (row?.id) {
    upsertOrder(row, { announce: true });
    renderStoreOrderUi();
  }
}

async function startStoreOrdersRealtime() {
  if (realtimeChannel) return true;
  try {
    const client = await getRealtimeClient();
    const channel = client
      .channel('pos-store-orders')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'store_orders' },
        (payload) => handleRealtimePayload(payload),
      );

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('realtime subscribe timeout')), 8000);
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timeout);
          realtimeLive = true;
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timeout);
          reject(new Error(`realtime ${status}`));
        }
      });
    });

    realtimeChannel = channel;
    return true;
  } catch (err) {
    console.warn('store orders realtime unavailable — using poll fallback', err);
    realtimeLive = false;
    realtimeChannel = null;
    return false;
  }
}

export async function refreshStoreOrders({ silent = true } = {}) {
  try {
    const rows = await fetchOpenOrders();
    mergeOrders(rows);
    if (!bootstrapped) bootstrapped = true;
    renderStoreOrderUi();
    return rows;
  } catch (e) {
    console.error('store orders refresh failed', e);
    if (!silent) showToast('Could not load storefront orders', true);
    return [];
  }
}

function ensureDom() {
  let badge = document.getElementById('storeOrdersBadge');
  let btn = document.getElementById('storeOrdersBtn');
  if (!btn) {
    const actions = document.querySelector('.header-actions');
    if (actions) {
      btn = document.createElement('button');
      btn.className = 'icon-btn store-orders-btn';
      btn.id = 'storeOrdersBtn';
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Storefront orders');
      btn.title = 'Storefront orders';
      btn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path fill-rule="evenodd" clip-rule="evenodd" d="M8.8999 7.5C8.8999 6.28498 9.88488 5.3 11.0999 5.3H12.8999C14.1149 5.3 15.0999 6.28498 15.0999 7.5C15.0999 7.77615 15.3238 8 15.5999 8C15.876 8 16.0999 7.77615 16.0999 7.5C16.0999 5.73269 14.6672 4.3 12.8999 4.3H11.0999C9.33259 4.3 7.8999 5.73269 7.8999 7.5C7.8999 7.77615 8.12376 8 8.3999 8C8.67604 8 8.8999 7.77615 8.8999 7.5ZM5.7998 15.6V9.39999H18.1998V15.6C18.1998 17.0359 17.0357 18.2 15.5998 18.2H8.39981C6.96387 18.2 5.7998 17.0359 5.7998 15.6ZM4.7998 9.29999C4.7998 8.80294 5.20275 8.39999 5.6998 8.39999H18.2998C18.7969 8.39999 19.1998 8.80294 19.1998 9.29999V15.6C19.1998 17.5882 17.588 19.2 15.5998 19.2H8.39981C6.41158 19.2 4.7998 17.5882 4.7998 15.6V9.29999Z" fill="currentColor"/>
        </svg>
        <span class="fab-badge" id="storeOrdersBadge" style="display:none;">0</span>`;
      actions.insertBefore(btn, actions.firstChild);
      badge = document.getElementById('storeOrdersBadge');
    }
  }

  if (btn && !badge) {
    badge = document.createElement('span');
    badge.className = 'fab-badge';
    badge.id = 'storeOrdersBadge';
    badge.hidden = true;
    badge.style.display = 'none';
    badge.textContent = '0';
    btn.appendChild(badge);
  }

  let panel = document.getElementById('storeOrdersPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'storeOrdersPanel';
    panel.className = 'store-orders-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Storefront order stack');
    document.body.appendChild(panel);
  }

  if (btn && !btn.dataset.wired) {
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
      if (ignoreNextBagToggle) {
        ignoreNextBagToggle = false;
        return;
      }
      setStoreOrdersPanelOpen(!panelOpen);
    });
  }

  if (panel && !panel.dataset.wiredDismiss) {
    panel.dataset.wiredDismiss = '1';
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (!panelOpen) return;
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (panel.contains(target)) return;
        if (btn?.contains(target)) {
          // pointerdown closes; the following click would toggle it back open.
          ignoreNextBagToggle = true;
        }
        closeStoreOrdersPanel();
      },
      true,
    );
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && panelOpen) closeStoreOrdersPanel();
    });
  }

  if (panel && !panel.dataset.wiredActions) {
    panel.dataset.wiredActions = '1';
    panel.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-close-store-orders]')) {
        closeStoreOrdersPanel();
        return;
      }
      const load = target.closest('[data-load-store-order]');
      if (load) {
        void loadStoreOrderIntoCart(load.getAttribute('data-load-store-order'));
        return;
      }
      const cancel = target.closest('[data-cancel-store-order]');
      if (cancel) {
        void cancelStoreOrder(cancel.getAttribute('data-cancel-store-order'));
        return;
      }
      const dismiss = target.closest('[data-dismiss-store-order]');
      if (dismiss) {
        void dismissOrder(dismiss.getAttribute('data-dismiss-store-order'));
      }
    });
  }

  return { badge, btn, panel };
}

function stackItemHtml(order) {
  const cancelled = order.status === 'cancelled';
  const confirmed = Boolean(order.confirmed_at) || order.status === 'confirmed';
  const active = getActiveStoreOrderId() === order.id;
  const items = Array.isArray(order.items) ? order.items : [];
  const itemBits = items
    .slice(0, 2)
    .map((line) => escapeHtml(line.product_name || 'Item'))
    .join(' · ');
  const more = items.length > 2 ? ` · +${items.length - 2}` : '';
  const when = deliveryLabel(order);
  const orderedAt = orderTimeLabel(order);
  const statusKey = cancelled
    ? 'cancelled'
    : active
      ? 'active'
      : hasStoreOrderSession(order.id)
        ? 'loaded'
        : confirmed
          ? 'confirmed'
          : order.status === 'accepted'
            ? 'opened'
            : 'new';
  const statusLabel =
    {
      cancelled: 'Cancelled',
      active: 'In cart',
      loaded: 'Loaded',
      confirmed: 'Confirmed',
      opened: 'Opened',
      new: 'New',
    }[statusKey] || 'New';

  const primaryLabel = active
    ? 'View cart'
    : hasStoreOrderSession(order.id)
      ? 'Switch'
      : 'Load';

  const actions = cancelled
    ? `<button type="button" class="store-order-card__btn store-order-card__btn--ghost" data-dismiss-store-order="${escapeHtml(order.id)}">Dismiss</button>`
    : `<button type="button" class="store-order-card__btn store-order-card__btn--primary" data-load-store-order="${escapeHtml(order.id)}">${primaryLabel}</button>
       <button type="button" class="store-order-card__btn store-order-card__btn--quiet" data-cancel-store-order="${escapeHtml(order.id)}">Cancel</button>`;

  const metaParts = [];
  if (orderedAt) metaParts.push(escapeHtml(orderedAt));
  if (when) metaParts.push(escapeHtml(when));
  if (itemBits) metaParts.push(`${itemBits}${more}`);
  const meta = metaParts.join(' · ');

  return `
    <article
      class="store-order-card${cancelled ? ' is-cancelled' : ''}${confirmed && !cancelled ? ' is-confirmed' : ''}${active ? ' is-active' : ''}"
      data-store-order-id="${escapeHtml(order.id)}"
      data-status="${statusKey}"
    >
      <div class="store-order-card__main">
        <div class="store-order-card__title-row">
          <span class="store-order-card__name">${escapeHtml(orderTitle(order))}</span>
          <span class="store-order-card__status">${statusLabel}</span>
        </div>
        <div class="store-order-card__meta">${meta || 'No items'}</div>
      </div>
      <div class="store-order-card__side">
        <div class="store-order-card__total">${fmtUGX(order.subtotal_ugx || 0)}</div>
        <div class="store-order-card__actions">${actions}</div>
      </div>
    </article>`;
}

function stackListSignature(stacked) {
  return stacked
    .map((order) => {
      const cancelled = order.status === 'cancelled';
      const confirmed = Boolean(order.confirmed_at) || order.status === 'confirmed';
      const active = getActiveStoreOrderId() === order.id;
      const session = hasStoreOrderSession(order.id) ? '1' : '0';
      return `${order.id}:${order.status}:${cancelled ? 1 : 0}:${confirmed ? 1 : 0}:${active ? 1 : 0}:${session}:${order.subtotal_ugx || 0}`;
    })
    .join('|');
}

function stackEmptyHtml() {
  return `<div class="store-orders-panel__empty">
    <div class="store-orders-panel__empty-mark" aria-hidden="true"></div>
    <div class="store-orders-panel__empty-title">Queue clear</div>
    <div class="store-orders-panel__empty-body">New storefront orders land here.</div>
  </div>`;
}

function ensurePanelShell(panel) {
  if (panel.querySelector('.store-orders-panel__list')) return false;
  panel.innerHTML = `
    <div class="store-orders-panel__head">
      <div class="store-orders-panel__head-copy">
        <div class="store-orders-panel__eyebrow">Storefront</div>
        <div class="store-orders-panel__title">Order stack</div>
        <div class="store-orders-panel__sub" data-store-orders-sub></div>
      </div>
      <button type="button" class="store-orders-panel__close" data-close-store-orders aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18"/>
        </svg>
      </button>
    </div>
    <div class="store-orders-panel__list"></div>`;
  return true;
}

export function renderStoreOrderUi() {
  const { badge, btn, panel } = ensureDom();
  const stacked = getStackedStoreOrders();
  const count = waitingStoreOrderCount();
  const cancelled = cancelledVisibleCount();
  // Numeric badge is only for orders not yet loaded into the cart.
  const badgeCount = count;

  if (badge) {
    if (badgeCount > 0) {
      badge.hidden = false;
      badge.style.display = 'flex';
      badge.textContent = String(badgeCount);
      badge.classList.toggle('is-alert', false);
    } else {
      badge.hidden = true;
      badge.style.display = 'none';
      badge.textContent = '0';
      badge.classList.remove('is-alert');
    }
  }
  if (btn) {
    btn.classList.toggle('has-orders', badgeCount > 0);
    btn.classList.toggle('has-cancelled', cancelled > 0);
    btn.setAttribute('aria-expanded', panelOpen ? 'true' : 'false');
    btn.setAttribute(
      'aria-label',
      badgeCount > 0 ? `Storefront orders, ${badgeCount} waiting` : 'Storefront orders',
    );
  }

  updateFabBadge();
  window.__venusRefreshStoreOrderCartSwitcher?.();
  window.__venusSyncReviewCartChrome?.();

  if (!panel) return;

  const wasHidden = panel.hidden;
  panel.hidden = !panelOpen;
  if (!panelOpen) {
    panel.classList.remove('is-opening');
    return;
  }

  ensurePanelShell(panel);

  const sub = panel.querySelector('[data-store-orders-sub]') || panel.querySelector('.store-orders-panel__sub');
  if (sub) {
    sub.textContent = `${count} open${cancelled ? ` · ${cancelled} cancelled` : ''}`;
  }

  const listEl = panel.querySelector('.store-orders-panel__list');
  if (!listEl) return;

  const signature = stackListSignature(stacked);
  const listNeedsPaint = listEl.dataset.sig !== signature;
  if (listNeedsPaint) {
    const listScrollTop = listEl.scrollTop;
    const pageX = window.scrollX;
    const pageY = window.scrollY;
    const active = document.activeElement;
    if (active instanceof HTMLElement && listEl.contains(active)) {
      active.blur();
    }

    listEl.dataset.sig = signature;
    listEl.innerHTML = stacked.length ? stacked.map(stackItemHtml).join('') : stackEmptyHtml();
    listEl.scrollTop = listScrollTop;

    const restorePageScroll = () => {
      if (window.scrollX !== pageX || window.scrollY !== pageY) {
        window.scrollTo(pageX, pageY);
      }
    };
    restorePageScroll();
    requestAnimationFrame(restorePageScroll);
  }

  if (wasHidden) {
    panel.classList.add('is-opening');
    const clearOpening = () => panel.classList.remove('is-opening');
    panel.addEventListener('animationend', clearOpening, { once: true });
    // Fallback if animation is disabled.
    setTimeout(clearOpening, 320);
  }
}

function rowsToCartLines(items) {
  return (Array.isArray(items) ? items : []).map((line, index) => {
    const productId = String(line.product_id || '');
    const product = PRODUCTS.find((p) => p.id === productId);
    return {
      key: `store-${productId}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
      productId,
      name: product?.name || String(line.product_name || 'Item'),
      detail: String(line.detail || ''),
      breakdown: line.breakdown && typeof line.breakdown === 'object' ? { ...line.breakdown } : {},
      lineTotal: Math.round(Number(line.line_total) || 0),
      stockDeferred: true,
    };
  });
}

export async function confirmStoreOrder(orderId) {
  const order = orderCache.get(orderId);
  if (!order) {
    showToast('Order not found', true);
    return;
  }
  if (order.status === 'cancelled') {
    showToast('This order was cancelled', true);
    return;
  }
  // Pending in stack, or accepted in review cart before staff confirms for the customer.
  if (order.confirmed_at || order.status === 'confirmed' || order.status === 'checked_out') {
    showToast('Order already confirmed');
    return;
  }
  if (order.status !== 'pending' && order.status !== 'accepted') {
    showToast('Order already confirmed');
    return;
  }

  try {
    await markStoreOrderConfirmed(order.id);
    showToast(`Confirmed ${orderTitle(order)}`);
  } catch (e) {
    console.error('confirm store order failed', e);
    showToast('Could not confirm order', true);
  }
}

export async function cancelStoreOrder(orderId) {
  const order = orderCache.get(orderId);
  if (!order) {
    showToast('Order not found', true);
    return;
  }
  if (order.status === 'cancelled') {
    showToast('Order already cancelled');
    return;
  }
  if (order.status === 'checked_out') {
    showToast('Order already checked out', true);
    return;
  }

  const wasOpen = panelOpen;
  closeStoreOrdersPanel();

  const ok = await showConfirm(`Cancel ${orderTitle(order)}'s order? The customer will be notified.`);
  if (!ok) {
    if (wasOpen) openStoreOrdersPanel();
    return;
  }

  staffCancelledIds.add(order.id);
  try {
    await markStoreOrderCancelled(order.id);
    showToast(`Cancelled ${orderTitle(order)}`);
    if (getActiveStoreOrderId() === order.id) {
      document.dispatchEvent(
        new CustomEvent('store-order:cancelled', {
          detail: { orderId: order.id, byStaff: true },
        }),
      );
    }
  } catch (e) {
    staffCancelledIds.delete(order.id);
    console.error('cancel store order failed', e);
    showToast('Could not cancel order', true);
  }
}

export async function loadStoreOrderIntoCart(orderId) {
  const order = orderCache.get(orderId);
  if (!order) {
    showToast('Order not found', true);
    return;
  }
  if (order.status === 'cancelled') {
    showToast('This order was cancelled', true);
    dropStoreOrderSession(orderId);
    return;
  }

  const activeId = getActiveStoreOrderId();

  // Already viewing this storefront order — just reopen the cart.
  if (activeId === orderId) {
    captureStoreOrderSession();
    closeStoreOrdersPanel();
    openLoadedOrderModal();
    renderStoreOrderUi();
    return;
  }

  // Save the current storefront cart before switching to another.
  if (activeId) {
    captureStoreOrderSession();
  } else {
    // Park walk-in compose so staff can switch back via the compose FAB.
    captureComposeDraft();
  }

  // Restore a previously loaded session (keeps credit toggle, etc.).
  if (hasStoreOrderSession(orderId) && restoreStoreOrderSession(orderId)) {
    try {
      if (order.status === 'pending' || order.status === 'confirmed') {
        await markStoreOrderAccepted(order.id);
      }
    } catch (e) {
      console.error('mark accepted failed', e);
    }
    closeStoreOrdersPanel();
    openLoadedOrderModal();
    renderStoreOrderUi();
    return;
  }

  applyStorefrontOrderToCart({
    storeOrderId: order.id,
    customerName: order.customer_name || '',
    phoneE164: order.phone_e164 || '',
    deliveryEnabled: order.delivery_enabled !== false,
    delivery: order.delivery || {},
    deliveryFeeUgx: order.delivery_fee_ugx,
    deliveryDistanceKm: order.delivery_distance_km,
    deliveryDurationMin: order.delivery_duration_min,
    locationLabel: order.location_label || '',
    locationLat: order.location_lat,
    locationLng: order.location_lng,
    cartLines: rowsToCartLines(order.items),
  });

  try {
    if (order.status === 'pending' || order.status === 'confirmed') {
      await markStoreOrderAccepted(order.id);
    }
  } catch (e) {
    console.error('mark accepted failed', e);
  }

  closeStoreOrdersPanel();
  openLoadedOrderModal();
  renderStoreOrderUi();
}

/** FAB review button: reopen an accepted storefront order after refresh / empty live cart. */
export async function openAcceptedStoreOrderFromFab() {
  const accepted = getStackedStoreOrders().filter((o) => o.status === 'accepted');
  if (!accepted.length) {
    showToast('No storefront orders in cart', true);
    updateFabBadge();
    return;
  }
  await loadStoreOrderIntoCart(accepted[0].id);
}

export function startStoreOrdersRuntime() {
  ensureDom();
  window.__venusGetSwitchableStoreOrders = () =>
    getStackedStoreOrders().filter((o) => o.status !== 'cancelled');
  window.__venusLoadStoreOrderIntoCart = (id) => loadStoreOrderIntoCart(id);
  window.__venusOpenAcceptedStoreOrderFromFab = () => openAcceptedStoreOrderFromFab();
  window.__venusRenderStoreOrderUi = renderStoreOrderUi;
  window.__venusLoadedStoreOrderCount = loadedStoreOrderCount;
  window.__venusReleaseStoreOrderFromCart = (id) => releaseStoreOrderFromCart(id);
  window.__venusConfirmStoreOrder = (id) => confirmStoreOrder(id);

  renderStoreOrderUi();
  void refreshStoreOrders({ silent: true }).then(() => {
    void startStoreOrdersRealtime();
  });

  if (pollTimer == null) {
    pollTimer = setInterval(() => {
      // Skip frequent work when Realtime is healthy and tab is hidden.
      if (realtimeLive && document.visibilityState === 'hidden') return;
      void refreshStoreOrders({ silent: true });
    }, FALLBACK_POLL_MS);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshStoreOrders({ silent: true });
  });

  // Older builds wrote `#store-orders` while the panel was open; strip it on boot
  // so refresh never leaves the stack stuck open. In-app deep links still open via hashchange.
  clearStoreOrdersHash();

  window.addEventListener('hashchange', () => {
    if (storeOrdersHashActive()) consumeStoreOrdersHash();
  });
}
