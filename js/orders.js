import { dataStore } from './store/index.js';
import { sbFetch } from './api.js';
import {
  CAT_MAP,
  PRODUCTS,
} from './config.js';
import { clientAutocompleteMarkup, wireClientAutocomplete } from './client-autocomplete.js';
import { resolveClientId } from './clients.js';
import {
  ICON_CASH,
  ICON_LOCATE,
  ICON_PIN,
  ICON_ROUTE,
  loadGoogleMaps,
  predictSafeBodaFee,
} from './delivery.js';
import {
  deliveryPlaceFieldMarkup,
  reverseGeocodeLabel,
  setDeliveryFieldValue,
  setPlacesSearchOrigin,
  wireDeliveryPlacesInputs,
} from './places-autocomplete.js';
import { adjustStock, renderStockGlance } from './inventory.js';
import { notifyCreditSale, notifyStockCrossing } from './notifications.js';
import {
  buildLineFromConfig,
  clearManualQtyEdit,
  productDetailLabel,
  productPickButtonHtml,
  renderProductConfigView,
  renderProductPickPanel,
  wireProductConfigView,
  wireProductPickButtons,
} from './product-config.js';
import {
  animateCheckoutProcessing,
  animateCheckoutSuccess,
  animateFlavorMeter,
  animateModalContent,
  closeModal,
  isModalOpen,
  openModal,
  pressButton,
  pulseFabBadge,
  readFlavorMeterScale,
  wireGsapAccordions,
} from './animations.js';
import {
  cartTotal,
  clients,
  draftStock,
  getCart,
  getOrderMeta,
  inventory,
  resetDraftStock,
  salesCache,
  setCart,
  setOrderMeta,
} from './state.js';
import { copyText, escapeHtml, fmtUGX, showConfirm, showToast } from './utils.js';
import {
  getClientOutstandingCredit,
  sumCreditOwed,
} from './credit.js';

let modalMode = 'cart';
let configProduct = null;
let configSelection = {};
let editingCartKey = null;
let editingCartItem = null;
let checkoutOrigin = null;
let checkoutPickupText = '';
let checkoutDest = null;
let checkoutDestText = '';
let checkoutDistanceKm = null;
let checkoutDurationMin = null;
let checkoutFeeValue = '';
let checkoutFeeManuallyEdited = false;
/** Model suggestion snapshotted when autofilled — used for accuracy logging at checkout. */
let checkoutPredictedFee = null;
let pickupAutoRequested = false;
/** Bumps when a newer GPS fix / geocode should win (ignore stale callbacks). */
let pickupLocateGen = 0;
/** True once the cashier edits pickup — auto labels must not overwrite. */
let pickupTouchedByUser = false;
let lastCheckoutReceipt = null;
let lastCheckoutProcessing = null;
let lastOrderModalMode = null;
let checkoutInFlight = false;

/**
 * In-memory carts for storefront orders staff have opened.
 * Lets the cart switcher flip between multiple loaded orders without losing credit toggles.
 * @type {Map<string, { cart: object[], meta: object, checkout: object }>}
 */
const storeOrderSessions = new Map();

/**
 * Walk-in compose cart parked while staff review storefront orders.
 * @type {{ cart: object[], meta: object, checkout: object } | null}
 */
let composeDraft = null;

function composeMetaHasContent(meta) {
  if (!meta || typeof meta !== 'object') return false;
  return Boolean(
    meta.clientName ||
      meta.clientPhone ||
      meta.deliveryTimeLabel ||
      meta.deliveryLocationLabel ||
      meta.deliveryTimeMode ||
      meta.deliveryDeliverAt ||
      meta.clientId ||
      meta.isCredit,
  );
}

function composeCheckoutHasContent(snap) {
  if (!snap || typeof snap !== 'object') return false;
  return Boolean(
    snap.pickupText ||
      snap.destText ||
      snap.feeValue ||
      snap.origin ||
      snap.dest ||
      snap.distanceKm != null,
  );
}

function composeLiveHasContent() {
  return (
    getCart().length > 0 ||
    composeMetaHasContent(getOrderMeta()) ||
    composeCheckoutHasContent(snapshotCheckoutDelivery())
  );
}

/** Park the walk-in cart so storefront review can take over the live slot. */
export function captureComposeDraft() {
  if (getActiveStoreOrderId()) return;
  if (!composeLiveHasContent()) {
    composeDraft = null;
    return;
  }
  composeDraft = {
    cart: cloneCartLines(getCart()),
    meta: { ...getOrderMeta(), storeOrderId: '' },
    checkout: snapshotCheckoutDelivery(),
  };
}

function restoreComposeDraft() {
  resetDraftStock();
  if (composeDraft) {
    setCart(cloneCartLines(composeDraft.cart));
    setOrderMeta({ ...emptyOrderMeta(), ...composeDraft.meta, storeOrderId: '' });
    applyCheckoutDeliverySnapshot(composeDraft.checkout);
  } else {
    setCart([]);
    setOrderMeta(emptyOrderMeta());
    resetCheckoutDelivery();
  }
  pickupAutoRequested = false;
}

/** Switch live cart to walk-in compose (parks any active storefront review). */
export function activateComposeCart() {
  if (!getActiveStoreOrderId()) return;
  captureStoreOrderSession();
  restoreComposeDraft();
  updateFabBadge();
}

/** Switch live cart to storefront review (parks walk-in compose when needed). */
export function activateReviewCart() {
  if (getActiveStoreOrderId()) return true;

  captureComposeDraft();

  const nextId = peekNextStoreOrderSessionId() || listStoreOrderSessionIds()[0] || '';
  if (nextId && restoreStoreOrderSession(nextId)) {
    window.__venusRenderStoreOrderUi?.();
    return true;
  }

  return false;
}

function clientOpenCreditSummary(clientId) {
  const open = getClientOutstandingCredit(salesCache, clientId);
  if (!open.length) return null;
  return {
    count: open.length,
    totalUgx: sumCreditOwed(open),
  };
}

function clientCreditHintHtml(clientId, { creditOn = false } = {}) {
  const summary = clientOpenCreditSummary(clientId);
  if (!summary) return '';
  const ordersLabel =
    summary.count === 1 ? '1 open credit order' : `${summary.count} open credit orders`;
  const warn = creditOn
    ? `<p class="credit-warning" id="cartCreditDebtWarning">Already owes ${fmtUGX(summary.totalUgx)} — this will stack another credit.</p>`
    : '';
  return `<div class="client-credit-hint" id="cartClientCreditHint">${escapeHtml(ordersLabel)} · ${fmtUGX(summary.totalUgx)} owed</div>${warn}`;
}

function getOrderClientName() {
  return getOrderMeta().clientName || '';
}

function getOrderClientId() {
  return getOrderMeta().clientId || '';
}

function getOrderIsCredit() {
  return !!getOrderMeta().isCredit;
}

function getOrderClientPhone() {
  return getOrderMeta().clientPhone || '';
}

function getOrderDeliveryTimeLabel() {
  return getOrderMeta().deliveryTimeLabel || '';
}

function getOrderDeliveryLocationLabel() {
  return String(getOrderMeta().deliveryLocationLabel || checkoutDestText || '').trim();
}

function getOrderDeliveryEnabled() {
  return getOrderMeta().deliveryEnabled !== false;
}

export function getActiveStoreOrderId() {
  return getOrderMeta().storeOrderId || '';
}

function emptyOrderMeta(extra = {}) {
  return {
    clientName: '',
    clientId: '',
    isCredit: false,
    clientPhone: '',
    deliveryEnabled: true,
    deliveryTimeLabel: '',
    deliveryLocationLabel: '',
    deliveryTimeMode: '',
    deliveryDeliverAt: '',
    storeOrderId: '',
    ...extra,
  };
}

function snapshotCheckoutDelivery() {
  return {
    origin: checkoutOrigin ? { ...checkoutOrigin } : null,
    pickupText: checkoutPickupText,
    dest: checkoutDest ? { ...checkoutDest } : null,
    destText: checkoutDestText,
    distanceKm: checkoutDistanceKm,
    durationMin: checkoutDurationMin,
    feeValue: checkoutFeeValue,
    feeManuallyEdited: checkoutFeeManuallyEdited,
    predictedFee: checkoutPredictedFee,
  };
}

function applyCheckoutDeliverySnapshot(snap) {
  if (!snap) {
    resetCheckoutDelivery();
    return;
  }
  checkoutOrigin = snap.origin ? { ...snap.origin } : null;
  checkoutPickupText = snap.pickupText || '';
  checkoutDest = snap.dest ? { ...snap.dest } : null;
  checkoutDestText = snap.destText || '';
  checkoutDistanceKm = snap.distanceKm ?? null;
  checkoutDurationMin = snap.durationMin ?? null;
  checkoutFeeValue = snap.feeValue || '';
  checkoutFeeManuallyEdited = Boolean(snap.feeManuallyEdited);
  checkoutPredictedFee = snap.predictedFee ?? null;
}

function cloneCartLines(lines) {
  return (Array.isArray(lines) ? lines : []).map((line) => ({
    ...line,
    breakdown: line.breakdown && typeof line.breakdown === 'object' ? { ...line.breakdown } : {},
  }));
}

/** Persist the active storefront order so staff can switch back to it. */
export function captureStoreOrderSession() {
  const id = String(getActiveStoreOrderId() || '');
  if (!id) return;
  storeOrderSessions.set(id, {
    cart: cloneCartLines(getCart()),
    meta: { ...getOrderMeta() },
    checkout: snapshotCheckoutDelivery(),
  });
}

export function hasStoreOrderSession(orderId) {
  const id = String(orderId || '');
  return Boolean(id) && storeOrderSessions.has(id);
}

/** Restore a previously loaded storefront order into the active cart. */
export function restoreStoreOrderSession(orderId) {
  const id = String(orderId || '');
  const session = storeOrderSessions.get(id);
  if (!session) return false;
  resetDraftStock();
  setCart(cloneCartLines(session.cart));
  setOrderMeta({ ...emptyOrderMeta(), ...session.meta, storeOrderId: id });
  applyCheckoutDeliverySnapshot(session.checkout);
  pickupAutoRequested = false;
  updateFabBadge();
  return true;
}

export function dropStoreOrderSession(orderId) {
  const id = String(orderId || '');
  if (id) storeOrderSessions.delete(id);
  updateFabBadge();
}

export function listStoreOrderSessionIds() {
  return [...storeOrderSessions.keys()];
}

export function peekNextStoreOrderSessionId(exceptId = '') {
  const skip = String(exceptId || '');
  for (const id of storeOrderSessions.keys()) {
    if (id && id !== skip) return id;
  }
  return '';
}

function cartStoreOrderSwitcherHtml(activeId) {
  const orders = window.__venusGetSwitchableStoreOrders?.() || [];
  if (!Array.isArray(orders) || orders.length < 2) return '';

  const tabs = orders
    .map((order) => {
      const id = String(order?.id || '');
      if (!id) return '';
      const name = String(order.customer_name || '').trim() || 'Storefront order';
      const active = id === activeId;
      const loaded = hasStoreOrderSession(id);
      const short = name.length > 16 ? `${name.slice(0, 15)}…` : name;
      return `<button type="button" class="cart-order-switcher__tab${active ? ' is-active' : ''}${loaded && !active ? ' is-loaded' : ''}" role="tab" aria-selected="${active ? 'true' : 'false'}" data-switch-store-order="${escapeHtml(id)}" title="${escapeHtml(name)}">${escapeHtml(short)}</button>`;
    })
    .filter(Boolean)
    .join('');

  if (!tabs) return '';
  return `<div class="cart-order-switcher" role="tablist" aria-label="Switch storefront order">${tabs}</div>`;
}

/** Ordered ids for review panels — stacked list first, then any leftover sessions. */
function orderedReviewSessionIds(activeId = getActiveStoreOrderId()) {
  const ids = [];
  const seen = new Set();
  const push = (raw) => {
    const id = String(raw || '');
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };

  const orders = window.__venusGetSwitchableStoreOrders?.() || [];
  if (Array.isArray(orders)) {
    for (const order of orders) {
      const id = String(order?.id || '');
      if (hasStoreOrderSession(id) || id === activeId) push(id);
    }
  }
  for (const id of storeOrderSessions.keys()) push(id);
  push(activeId);
  return ids;
}

function getActiveReviewPanel(root = document.getElementById('orderModalBody')) {
  const id = getActiveStoreOrderId();
  if (!root || !id) return null;
  return root.querySelector(`[data-store-order-panel="${CSS.escape(id)}"]`);
}

function getActiveCartChromeRoot(root = document.getElementById('orderModalBody')) {
  return getActiveReviewPanel(root) || root;
}

function setReviewDeckIndex(track, orderId, { instant = false } = {}) {
  if (!track) return;
  const panels = [...track.querySelectorAll('[data-store-order-panel]')];
  const index = Math.max(
    0,
    panels.findIndex((el) => el.getAttribute('data-store-order-panel') === orderId),
  );
  if (instant) track.classList.add('is-instant');
  track.style.setProperty('--deck-index', String(index));
  panels.forEach((el, i) => {
    const active = i === index;
    el.classList.toggle('is-active', active);
    el.setAttribute('aria-hidden', active ? 'false' : 'true');
  });
  if (instant) {
    // Force layout so the next slide still animates.
    void track.offsetWidth;
    track.classList.remove('is-instant');
  }
}

function reviewPropsFromSession(orderId, session) {
  const meta = { ...emptyOrderMeta(), ...(session?.meta || {}) };
  const checkout = session?.checkout || {};
  return {
    storeOrderId: orderId,
    cart: Array.isArray(session?.cart) ? session.cart : [],
    orderClientName: meta.clientName || '',
    orderClientId: meta.clientId || '',
    orderIsCredit: !!meta.isCredit,
    orderClientPhone: meta.clientPhone || '',
    orderDeliveryTime: meta.deliveryTimeLabel || '',
    orderDeliveryLocation:
      String(meta.deliveryLocationLabel || checkout.destText || '').trim(),
    orderDeliveryEnabled: meta.deliveryEnabled !== false,
  };
}

function reviewPropsFromLiveState(orderId = getActiveStoreOrderId()) {
  return {
    storeOrderId: orderId,
    cart: getCart(),
    orderClientName: getOrderClientName(),
    orderClientId: getOrderClientId(),
    orderIsCredit: getOrderIsCredit(),
    orderClientPhone: getOrderClientPhone(),
    orderDeliveryTime: getOrderDeliveryTimeLabel(),
    orderDeliveryLocation: getOrderDeliveryLocationLabel(),
    orderDeliveryEnabled: getOrderDeliveryEnabled(),
  };
}

function renderReviewDeckHtml(activeId) {
  captureStoreOrderSession();
  const ids = orderedReviewSessionIds(activeId);
  const index = Math.max(0, ids.indexOf(activeId));
  const panels = ids
    .map((id) => {
      const props =
        id === activeId
          ? reviewPropsFromLiveState(id)
          : reviewPropsFromSession(id, storeOrderSessions.get(id));
      const sheet = renderReviewCartHtml(props);
      return sheet.replace(
        'class="cart-sheet cart-sheet--review"',
        `class="cart-sheet cart-sheet--review${id === activeId ? ' is-active' : ''}"`,
      );
    })
    .join('');

  return `
    <div class="cart-review-deck" data-cart-review-deck>
      <div class="cart-review-deck__track" data-cart-review-track style="--deck-index: ${index}">
        ${panels}
      </div>
    </div>`;
}

function syncReviewCartChrome(orderModalBody = document.getElementById('orderModalBody')) {
  if (!orderModalBody) return;
  const activeId = getActiveStoreOrderId();
  const title = orderModalBody.querySelector('#orderModalTitle');
  if (title) title.textContent = activeId ? 'Orders' : 'Current order';

  let storeOrderCancelled = false;
  if (activeId) {
    try {
      storeOrderCancelled = window.__venusStoreOrderCacheGet?.(activeId)?.status === 'cancelled';
    } catch {
      storeOrderCancelled = false;
    }
  }
  const existingBanner = orderModalBody.querySelector('[data-store-order-cancelled-banner]');
  if (storeOrderCancelled && !existingBanner) {
    const banner = document.createElement('div');
    banner.className = 'store-order-cancelled-banner';
    banner.dataset.storeOrderCancelledBanner = '1';
    banner.textContent = 'This order was cancelled';
    orderModalBody.querySelector('.modal-header')?.insertAdjacentElement('afterend', banner);
  } else if (!storeOrderCancelled && existingBanner) {
    existingBanner.remove();
  }

  const cancelBtn = orderModalBody.querySelector('#cancelOrderBtn');
  if (cancelBtn) cancelBtn.textContent = activeId ? 'Clear' : 'Cancel';

  refreshStoreOrderCartSwitcher();
  updateCartCheckoutState();
  wireReviewCreditToggles(orderModalBody);
  wireReviewConfirmPills(orderModalBody);
  syncReviewConfirmPills(orderModalBody);
}

function wireReviewCreditToggles(root) {
  root?.querySelectorAll('[data-credit-toggle]').forEach((btn) => {
    if (btn.dataset.wired === '1') return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
      const panel = btn.closest('[data-store-order-panel]');
      const panelId = panel?.getAttribute('data-store-order-panel') || '';
      if (panelId && panelId !== getActiveStoreOrderId()) return;
      setOrderIsCredit(!getOrderIsCredit());
      if (getActiveStoreOrderId()) captureStoreOrderSession();
      updateCartCheckoutState();
    });
  });
}

/**
 * Slide to an already-loaded storefront order without rebuilding the review cart.
 * @returns {boolean} true when the deck handled the switch
 */
function slideStoreOrderInOpenCart(orderId) {
  const orderModal = document.getElementById('orderModal');
  const body = document.getElementById('orderModalBody');
  const track = body?.querySelector('[data-cart-review-track]');
  if (!orderModal || !body || !track || !isModalOpen(orderModal) || modalMode !== 'cart') {
    return false;
  }

  const id = String(orderId || '');
  if (!id || id === getActiveStoreOrderId()) return true;

  const panel = track.querySelector(`[data-store-order-panel="${CSS.escape(id)}"]`);
  if (!panel || !hasStoreOrderSession(id)) return false;

  captureStoreOrderSession();
  if (!restoreStoreOrderSession(id)) return false;

  setReviewDeckIndex(track, id);
  syncReviewCartChrome(body);
  return true;
}

/**
 * Soft-update an open review deck: slide to an existing panel or append a new one.
 * @returns {boolean} true when the open deck handled the update
 */
function softUpdateOpenReviewDeck() {
  const orderModal = document.getElementById('orderModal');
  const body = document.getElementById('orderModalBody');
  const track = body?.querySelector('[data-cart-review-track]');
  const activeId = getActiveStoreOrderId();
  if (
    !orderModal ||
    !body ||
    !track ||
    !activeId ||
    !isModalOpen(orderModal) ||
    modalMode !== 'cart'
  ) {
    return false;
  }

  captureStoreOrderSession();
  let panel = track.querySelector(`[data-store-order-panel="${CSS.escape(activeId)}"]`);
  if (!panel) {
    track.insertAdjacentHTML('beforeend', renderReviewCartHtml(reviewPropsFromLiveState(activeId)));
    panel = track.querySelector(`[data-store-order-panel="${CSS.escape(activeId)}"]`);
    if (panel) {
      wireCartCopyButtons(panel);
      wireReviewCreditToggles(panel);
    }
  }

  setReviewDeckIndex(track, activeId);
  syncReviewCartChrome(body);
  return true;
}

function wireCartStoreOrderSwitcher(root) {
  root?.querySelectorAll('[data-switch-store-order]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-switch-store-order');
      if (!id || id === getActiveStoreOrderId()) return;
      if (slideStoreOrderInOpenCart(id)) return;
      void window.__venusLoadStoreOrderIntoCart?.(id);
    });
  });
}

/** Keep the cart tab strip in sync when the storefront stack changes. */
export function refreshStoreOrderCartSwitcher() {
  if (modalMode !== 'cart' || !getActiveStoreOrderId()) return;
  const orderModal = document.getElementById('orderModal');
  const body = document.getElementById('orderModalBody');
  if (!orderModal || !body || !isModalOpen(orderModal)) return;

  const html = cartStoreOrderSwitcherHtml(getActiveStoreOrderId());
  const existing = body.querySelector('.cart-order-switcher');
  if (!html) {
    existing?.remove();
    return;
  }
  if (existing) {
    existing.outerHTML = html;
  } else {
    const anchor =
      body.querySelector('[data-store-order-cancelled-banner]') ||
      body.querySelector('.modal-header');
    anchor?.insertAdjacentHTML('afterend', html);
  }
  wireCartStoreOrderSwitcher(body);
}

function setOrderClient(client) {
  const meta = getOrderMeta();
  if (!client) {
    meta.clientName = '';
    meta.clientId = '';
  } else {
    meta.clientName = client.name;
    meta.clientId = client.id;
  }
  setOrderMeta(meta);
}

function setOrderIsCredit(isCredit) {
  const meta = getOrderMeta();
  meta.isCredit = isCredit;
  setOrderMeta(meta);
}

function setOrderClientPhone(phone) {
  const meta = getOrderMeta();
  meta.clientPhone = String(phone || '').trim();
  setOrderMeta(meta);
}

function setOrderDeliveryTimeLabel(label) {
  const meta = getOrderMeta();
  meta.deliveryTimeLabel = String(label || '').trim();
  setOrderMeta(meta);
}

function adjustDraftForItem(item, direction) {
  if (!item || item.stockDeferred) return;
  Object.entries(item.breakdown || {}).forEach(([id, qty]) => {
    draftStock[id] = (draftStock[id] || 0) + direction * qty;
  });
}

function cartItemToConfigSelection(item) {
  const p = PRODUCTS.find((pr) => pr.id === item.productId);
  if (!p) return {};
  if (p.rule === 'choose_any' || p.rule === 'spliff_qty') return { ...item.breakdown };
  if (p.rule === 'choose_variety') {
    const sel = { ...item.breakdown };
    delete sel.classic;
    return sel;
  }
  if (p.rule === 'single_qty') {
    return { qty: item.breakdown[p.categoryId] || 0 };
  }
  return {};
}

function resetCheckoutDelivery() {
  checkoutOrigin = null;
  checkoutPickupText = '';
  checkoutDest = null;
  checkoutDestText = '';
  checkoutDistanceKm = null;
  checkoutDurationMin = null;
  checkoutFeeValue = '';
  checkoutFeeManuallyEdited = false;
  checkoutPredictedFee = null;
  pickupAutoRequested = false;
  pickupTouchedByUser = false;
  pickupLocateGen += 1;
}

export function updateFabBadge() {
  const fabBadge = document.getElementById('fabBadge');
  const fabReview = document.getElementById('fabReviewOrders');
  const fabStack = document.getElementById('fabStack');
  // DB `accepted` status is the source of truth (survives refresh).
  const count =
    typeof window.__venusLoadedStoreOrderCount === 'function'
      ? window.__venusLoadedStoreOrderCount()
      : 0;
  const showReview = count > 0;

  if (fabReview) {
    fabReview.hidden = !showReview;
    fabReview.setAttribute(
      'aria-label',
      showReview
        ? `Review storefront orders, ${count} in cart`
        : 'Review storefront orders',
    );
  }
  fabStack?.classList.toggle('has-review-fab', showReview);

  if (fabBadge) {
    if (showReview) {
      fabBadge.style.display = 'flex';
      fabBadge.textContent = String(count);
    } else {
      fabBadge.style.display = 'none';
    }
  }
  pulseFabBadge(count);
}

function closeOrderModal() {
  if (modalMode === 'processing') return;

  if (modalMode === 'success') {
    dismissSuccessView();
    return;
  }

  if (editingCartItem) {
    adjustDraftForItem(editingCartItem, -1);
    const cart = getCart();
    cart.push(editingCartItem);
    setCart(cart);
    editingCartKey = null;
    editingCartItem = null;
    updateFabBadge();
  }
  const orderModal = document.getElementById('orderModal');
  if (orderModal) closeModal(orderModal);
}

function renderOrderModal() {
  const prevMode = lastOrderModalMode;
  lastOrderModalMode = modalMode;
  const isCartRefresh = modalMode === 'cart' && prevMode === 'cart';
  const isConfigRefresh = modalMode === 'config' && prevMode === 'config';

  if (modalMode === 'cart') renderCartView();
  else if (modalMode === 'pick') renderPickView();
  else if (modalMode === 'config') renderConfigView();
  else if (modalMode === 'processing') renderProcessingView();
  else if (modalMode === 'success') renderSuccessView();

  const orderModal = document.getElementById('orderModal');
  const orderModalBody = document.getElementById('orderModalBody');
  if (orderModalBody) orderModalBody.dataset.mode = modalMode;
  if (
    orderModalBody &&
    modalMode !== 'success' &&
    modalMode !== 'processing' &&
    !isCartRefresh &&
    !isConfigRefresh &&
    isModalOpen(orderModal)
  ) {
    animateModalContent(orderModalBody);
  }
}

function snapshotInventory(ids) {
  const snap = {};
  ids.forEach((id) => {
    snap[id] = inventory[id];
  });
  return snap;
}

function applyInventorySnapshot(snap) {
  Object.entries(snap).forEach(([id, stock]) => {
    inventory[id] = stock;
    const el = document.getElementById(`inv-count-${id}`);
    if (el && !el.querySelector('input')) el.textContent = stock;
  });
}

function dismissSuccessView() {
  lastCheckoutReceipt = null;
  lastCheckoutProcessing = null;
  modalMode = 'cart';
  const orderModal = document.getElementById('orderModal');
  if (orderModal) closeModal(orderModal);
}

function renderProcessingView() {
  const orderModalBody = document.getElementById('orderModalBody');
  if (!orderModalBody || !lastCheckoutProcessing) return;

  const { total, itemCount, clientName, isCredit } = lastCheckoutProcessing;
  const itemLabel = itemCount === 1 ? '1 item' : `${itemCount} items`;
  const statusLabel = isCredit ? 'Recording on credit…' : 'Recording order…';

  orderModalBody.innerHTML = `
    <div class="modal-header">
      <div class="modal-title" id="orderModalTitle">${statusLabel}</div>
    </div>
    <div class="checkout-processing">
      <div class="checkout-processing-hero">
        <div class="checkout-processing-mark" aria-hidden="true">
          <span class="checkout-processing-mark-glow"></span>
          <svg class="checkout-processing-mark-svg" viewBox="0 0 48 48" fill="none">
            <circle class="checkout-processing-mark-track" cx="24" cy="24" r="20" />
            <circle class="checkout-processing-mark-arc" cx="24" cy="24" r="20" />
          </svg>
        </div>
        <div class="checkout-processing-total">${fmtUGX(total)}</div>
        <div class="checkout-processing-sub">${itemLabel}${clientName ? ` · ${escapeHtml(clientName)}` : ''}</div>
        <div class="checkout-processing-status" aria-live="polite">
          <span class="checkout-processing-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          Saving to ledger
        </div>
      </div>
    </div>`;

  animateCheckoutProcessing(orderModalBody);
}

function showCheckoutProcessing({ total, itemCount, clientName, isCredit }) {
  lastCheckoutProcessing = { total, itemCount, clientName, isCredit };
  modalMode = 'processing';

  const orderModal = document.getElementById('orderModal');
  if (orderModal && !isModalOpen(orderModal)) openModal(orderModal);
  renderOrderModal();
}

function restoreCheckoutCartView() {
  lastCheckoutProcessing = null;
  modalMode = 'cart';
  renderOrderModal();
}

function renderSuccessView({ animate = true } = {}) {
  const orderModalBody = document.getElementById('orderModalBody');
  if (!orderModalBody || !lastCheckoutReceipt) return;

  const { items, total, clientName, isCredit, delivery, deliveryFailed } = lastCheckoutReceipt;
  const itemLabel = items.length === 1 ? '1 item' : `${items.length} items`;
  const deliveryPending = Boolean(delivery?.pending);
  const deliverySaved = Boolean(delivery && !delivery.pending);
  const showBadges = Boolean(clientName || isCredit || delivery || deliveryFailed);
  const nextStoreOrderId = peekNextStoreOrderSessionId();
  const nextStoreOrder = nextStoreOrderId
    ? window.__venusStoreOrderCacheGet?.(nextStoreOrderId)
    : null;
  const nextStoreLabel = String(nextStoreOrder?.customer_name || '').trim() || 'Next order';
  const nextStoreShort =
    nextStoreLabel.length > 18 ? `${nextStoreLabel.slice(0, 17)}…` : nextStoreLabel;

  orderModalBody.innerHTML = `
    <div class="modal-header">
      <div class="modal-title" id="orderModalTitle">${isCredit ? 'Recorded on credit' : 'Order recorded'}</div>
      <button class="modal-close" id="orderClose" type="button" aria-label="Close">✕</button>
    </div>
    <div class="checkout-success-receipt">
      <div class="checkout-success-hero">
        <div class="checkout-success-mark" aria-hidden="true">
          <span class="checkout-success-mark-glow"></span>
          <svg class="checkout-success-mark-svg" viewBox="0 0 48 48" fill="none">
            <circle class="checkout-success-mark-ring" cx="24" cy="24" r="20" />
            <path class="checkout-success-mark-check" d="M15.5 24.5 L21.5 30.5 L33 17.5" />
          </svg>
        </div>
        <div class="checkout-success-total">${fmtUGX(total)}</div>
        <div class="checkout-success-sub">${itemLabel}</div>
      </div>
      ${showBadges ? `
      <div class="checkout-success-badges">
        ${clientName ? `<span class="checkout-badge checkout-badge--client">${escapeHtml(clientName)}</span>` : ''}
        ${isCredit ? `<span class="checkout-badge checkout-badge--credit">Credit — unpaid</span>` : ''}
        ${deliveryPending ? `<span class="checkout-badge checkout-badge--delivery">Saving delivery…</span>` : ''}
        ${deliverySaved ? `<span class="checkout-badge checkout-badge--delivery">Delivery logged</span>` : ''}
        ${deliveryFailed ? `<span class="checkout-badge checkout-badge--warn">Delivery not saved</span>` : ''}
      </div>` : ''}
      <div class="checkout-receipt-items">
        ${items
          .map(
            (item) => `
          <div class="cart-item checkout-receipt-item">
            <div class="checkout-receipt-item-main">
              <div class="ci-name">${escapeHtml(item.name)}</div>
              ${cartDetailHtml(item.detail)}
            </div>
            <div class="ci-price checkout-receipt-item-price">${fmtUGX(item.lineTotal)}</div>
          </div>`,
          )
          .join('')}
      </div>
      ${delivery ? `
      <div class="checkout-delivery-summary">
        <div class="checkout-delivery-summary-label">Delivery</div>
        <div class="checkout-delivery-route">
          <div class="checkout-delivery-stop">${ICON_LOCATE}<span>${escapeHtml(delivery.pickup || 'Pickup')}</span></div>
          <div class="checkout-delivery-stop">${ICON_PIN}<span>${escapeHtml(delivery.dest || 'Drop-off')}</span></div>
        </div>
        <div class="checkout-delivery-stats">
          ${delivery.distanceKm != null ? `<span>${ICON_ROUTE} ${delivery.distanceKm.toFixed(1)} km · ~${Math.round(delivery.durationMin || 0)} min</span>` : ''}
          ${delivery.fee ? `<span>${ICON_CASH} ${fmtUGX(delivery.fee)}</span>` : ''}
        </div>
      </div>` : ''}
    </div>
    <div class="checkout-success-footer">
      <div class="modal-btns">
        ${
          nextStoreOrderId
            ? `<button class="modal-btn cancel" id="checkoutSuccessDoneBtn" type="button">Done</button>
        <button class="modal-btn confirm" id="checkoutSuccessNextStoreBtn" type="button" title="${escapeHtml(nextStoreLabel)}">Next: ${escapeHtml(nextStoreShort)}</button>`
            : `<button class="modal-btn cancel" id="checkoutSuccessNewBtn" type="button">New order</button>
        <button class="modal-btn confirm" id="checkoutSuccessDoneBtn" type="button">Done</button>`
        }
      </div>
    </div>`;

  document.getElementById('orderClose')?.addEventListener('click', dismissSuccessView);
  document.getElementById('checkoutSuccessDoneBtn')?.addEventListener('click', dismissSuccessView);
  document.getElementById('checkoutSuccessNewBtn')?.addEventListener('click', () => {
    lastCheckoutReceipt = null;
    lastCheckoutProcessing = null;
    modalMode = 'pick';
    renderOrderModal();
  });
  document.getElementById('checkoutSuccessNextStoreBtn')?.addEventListener('click', () => {
    const id = nextStoreOrderId;
    lastCheckoutReceipt = null;
    lastCheckoutProcessing = null;
    if (id && restoreStoreOrderSession(id)) {
      modalMode = 'cart';
      renderOrderModal();
      window.__venusRenderStoreOrderUi?.();
      return;
    }
    if (id) {
      void window.__venusLoadStoreOrderIntoCart?.(id);
      return;
    }
    dismissSuccessView();
  });

  if (animate) animateCheckoutSuccess(orderModalBody);
  else orderModalBody.classList.add('checkout-success--static');
}

export function openOrderModal(productId) {
  configProduct = PRODUCTS.find((p) => p.id === productId);
  configSelection = {};
  clearManualQtyEdit();
  modalMode = 'config';
  renderOrderModal();
  const orderModal = document.getElementById('orderModal');
  if (orderModal) openModal(orderModal);
}

function updateCheckoutDistanceReadout() {
  const fields = document.querySelector('#orderModalBody .delivery-mini');
  if (!fields) return;
  let readout = fields.querySelector('.delivery-mini-readout');
  if (checkoutDistanceKm != null) {
    const html = `${ICON_ROUTE} ${checkoutDistanceKm.toFixed(1)} km · ~${Math.round(checkoutDurationMin)} min`;
    if (readout) readout.innerHTML = html;
    else {
      readout = document.createElement('div');
      readout.className = 'delivery-mini-readout';
      readout.innerHTML = html;
      const feeWrap = fields.querySelector('.delivery-input-wrap.fee');
      if (feeWrap) feeWrap.insertAdjacentElement('afterend', readout);
      else fields.appendChild(readout);
    }
  } else if (readout) {
    readout.remove();
  }
}

function applyPredictedFee() {
  if (checkoutFeeManuallyEdited || checkoutDistanceKm == null) return;
  const predicted = predictSafeBodaFee(checkoutDistanceKm, {
    durationMin: checkoutDurationMin,
    at: new Date(),
  });
  if (predicted == null) {
    checkoutPredictedFee = null;
    return;
  }
  checkoutPredictedFee = predicted;
  checkoutFeeValue = String(predicted);
  const feeInput = document.getElementById('deliveryFeeInputCart');
  if (feeInput) feeInput.value = checkoutFeeValue;
  updateCartDeliveryHint();
}

function computeCheckoutDistance() {
  if (!checkoutOrigin || !checkoutDest) {
    checkoutDistanceKm = null;
    updateCheckoutDistanceReadout();
    return;
  }
  loadGoogleMaps(() => {
    const service = new google.maps.DistanceMatrixService();
    service.getDistanceMatrix(
      {
        origins: [checkoutOrigin],
        destinations: [checkoutDest],
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (res, status) => {
        if (status === 'OK' && res.rows[0].elements[0].status === 'OK') {
          const el = res.rows[0].elements[0];
          checkoutDistanceKm = el.distance.value / 1000;
          checkoutDurationMin = el.duration.value / 60;
          applyPredictedFee();
        } else {
          checkoutDistanceKm = null;
          checkoutDurationMin = null;
        }
        updateCheckoutDistanceReadout();
      },
    );
  });
}

function updateCartDeliveryHint() {
  const hint = document.querySelector('#orderModalBody [data-cart-delivery-hint]');
  if (!hint) return;
  hint.textContent =
    checkoutDestText || checkoutPickupText || (checkoutFeeValue ? `${checkoutFeeValue} fee` : 'Optional');
}

function wireDeliveryAutocompletes() {
  wireDeliveryPlacesInputs(
    'deliveryPickupInput',
    'deliveryPickupDropdown',
    'deliveryDestInput',
    'deliveryDestDropdown',
    {
    onPickupSelect: ({ lat, lng, label }) => {
      pickupTouchedByUser = true;
      pickupLocateGen += 1; // cancel in-flight auto locate / geocode
      checkoutOrigin = { lat, lng };
      checkoutPickupText = label;
      setDeliveryFieldValue('deliveryPickupInput', label);
      updateCartDeliveryHint();
      computeCheckoutDistance();
    },
    onDestSelect: ({ lat, lng, label }) => {
      checkoutDest = { lat, lng };
      checkoutDestText = label;
      checkoutFeeManuallyEdited = false;
      checkoutPredictedFee = null;
      setDeliveryFieldValue('deliveryDestInput', label);
      updateCartDeliveryHint();
      computeCheckoutDistance();
    },
    onPickupFocus: () => {},
    onDestFocus: () => {},
    onPickupInput: (value) => {
      checkoutPickupText = value;
      if (value && value !== PICKUP_PROVISIONAL) pickupTouchedByUser = true;
      updateCartDeliveryHint();
      if (!value) {
        checkoutOrigin = null;
        checkoutDistanceKm = null;
        updateCheckoutDistanceReadout();
      }
    },
    onDestInput: (value) => {
      checkoutDestText = value;
      updateCartDeliveryHint();
      if (!value) {
        checkoutDest = null;
        checkoutDistanceKm = null;
        updateCheckoutDistanceReadout();
      }
    },
  });
}

const PICKUP_PROVISIONAL = 'Locating…';

function setPickupField(label) {
  checkoutPickupText = label;
  setDeliveryFieldValue('deliveryPickupInput', label);
  updateCartDeliveryHint();
}

function applyPickupCoords(latLng, gen) {
  if (gen !== pickupLocateGen) return;
  checkoutOrigin = latLng;
  setPlacesSearchOrigin(latLng);
  // Instant pin — don't wait on Maps / geocode for coords or distance.
  if (!checkoutPickupText || checkoutPickupText === PICKUP_PROVISIONAL) {
    setPickupField(PICKUP_PROVISIONAL);
  }
  computeCheckoutDistance();

  reverseGeocodeLabel(latLng, (label) => {
    if (gen !== pickupLocateGen || pickupTouchedByUser) return;
    if (!label) return;
    setPickupField(label);
    computeCheckoutDistance();
  });
}

function autoFillPickupLocation() {
  if (!navigator.geolocation) return;

  // Warm Maps + Places while GPS resolves.
  loadGoogleMaps(() => {});

  const gen = ++pickupLocateGen;
  pickupTouchedByUser = false;
  setPickupField(PICKUP_PROVISIONAL);

  const onFix = (pos) => {
    applyPickupCoords(
      { lat: pos.coords.latitude, lng: pos.coords.longitude },
      gen,
    );
  };

  // Fast path: network/cached fix (often <1s). High-accuracy GPS can take many seconds.
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      onFix(pos);
      // Quiet refine — only keep it if this locate session is still current.
      navigator.geolocation.getCurrentPosition(
        (pos2) => {
          if (gen !== pickupLocateGen) return;
          const next = { lat: pos2.coords.latitude, lng: pos2.coords.longitude };
          const prev = checkoutOrigin;
          if (
            prev &&
            Math.hypot(next.lat - prev.lat, next.lng - prev.lng) < 0.00015
          ) {
            return; // ~15m — not worth re-labeling
          }
          applyPickupCoords(next, gen);
        },
        () => {},
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
      );
    },
    () => {
      // Fallback when low-accuracy fails: one high-accuracy attempt with cache.
      navigator.geolocation.getCurrentPosition(
        onFix,
        () => {
          if (gen !== pickupLocateGen) return;
          if (checkoutPickupText === PICKUP_PROVISIONAL) setPickupField('');
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
      );
    },
    { enableHighAccuracy: false, maximumAge: 120000, timeout: 4000 },
  );
}

function updateCartCheckoutState() {
  const cart = getCart();
  const orderClientName = getOrderClientName();
  const orderClientId = getOrderClientId();
  const orderIsCredit = getOrderIsCredit();
  const clientMissing = !orderClientName;
  const chromeRoot = getActiveCartChromeRoot();
  const checkoutBtn = document.getElementById('checkoutBtn');
  if (checkoutBtn) {
    checkoutBtn.disabled = !cart.length || clientMissing;
    checkoutBtn.textContent = orderIsCredit ? 'Record on credit' : 'Checkout';
  }
  const creditChip =
    chromeRoot?.querySelector('[data-credit-toggle], #creditToggle') ||
    document.getElementById('creditToggle');
  if (creditChip) {
    creditChip.classList.toggle('is-on', orderIsCredit);
    creditChip.setAttribute('aria-checked', orderIsCredit ? 'true' : 'false');
  }

  const totalVal = chromeRoot?.querySelector('.cart-total-row .ct-val');
  if (totalVal) totalVal.textContent = fmtUGX(cartTotal(cart));

  const hintHost =
    chromeRoot?.querySelector('[data-cart-credit-hint]') ||
    document.getElementById('cartClientCreditHintSlot');
  if (hintHost) {
    hintHost.innerHTML = clientCreditHintHtml(orderClientId, { creditOn: orderIsCredit });
  }
}

const ICON_COPY = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

function cartLineQty(item) {
  return Object.values(item?.breakdown || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
}

/** National 9-digit phone for display/copy (Uganda mobile without country code). */
function phoneNineDigits(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.slice(-9);
}

function cartFlavorEntries(breakdown) {
  return Object.entries(breakdown || {})
    .filter(([, qty]) => Number(qty) > 0)
    .map(([id, qty]) => {
      const cat = CAT_MAP[id];
      if (!cat) return null;
      return { id, qty: Number(qty), name: cat.name, color: cat.color };
    })
    .filter(Boolean);
}

/** Max flavor dots shown in a cart row before collapsing into +N. */
const CART_SWATCH_VISIBLE = 8;

function cartFlavorSwatchesHtml(
  entries,
  { maxVisible = CART_SWATCH_VISIBLE, varietyPlainLast = false } = {},
) {
  if (!entries.length) return '';

  let flavors = entries;
  let plain = null;
  if (varietyPlainLast) {
    plain = entries.find((e) => e.id === 'classic') || null;
    flavors = entries.filter((e) => e.id !== 'classic');
  }

  // Keep Plain pinned at the end; overflow only collapses other flavors.
  const plainSlots = plain ? 1 : 0;
  const flavorSlots = Math.max(0, maxVisible - plainSlots);
  const visibleFlavors = flavors.slice(0, flavorSlots);
  const overflow = flavors.length - visibleFlavors.length;
  const orderedForLabel = plain ? [...flavors, plain] : entries;
  const label = orderedForLabel
    .map((e) => (e.qty > 1 ? `${e.name} ×${e.qty}` : e.name))
    .join(', ');

  const swatchHtml = (e) => {
    const bordered =
      String(e.color).toLowerCase() === '#ffffff' || String(e.color).toLowerCase() === '#fff'
        ? ' ci-swatch--bordered'
        : '';
    const title = e.qty > 1 ? `${e.name} ×${e.qty}` : e.name;
    return `
        <span class="ci-swatch${bordered}" role="listitem" style="--swatch:${e.color}" title="${escapeHtml(title)}">
          <span class="ci-swatch__dot" aria-hidden="true"></span>
          ${e.qty > 1 ? `<span class="ci-swatch__qty">×${e.qty}</span>` : ''}
        </span>`;
  };
  const overflowHtml =
    overflow > 0
      ? `<span class="ci-swatch-more" role="listitem" title="${escapeHtml(label)}">+${overflow}</span>`
      : '';
  const plainHtml =
    plain && (visibleFlavors.length || overflow > 0)
      ? `<span class="ci-swatch-sep" aria-hidden="true"></span>${swatchHtml(plain)}`
      : plain
        ? swatchHtml(plain)
        : '';

  return `
    <div class="ci-swatches" role="list" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">
      ${visibleFlavors.map(swatchHtml).join('')}
      ${overflowHtml}
      ${plainHtml}
    </div>`;
}

/** Keep long flavor lists to one line; full string stays in title for hover. */
function cartDetailHtml(detailText) {
  const text = String(detailText || '').trim();
  if (!text) return '';
  const parts = text.split(/,\s*/).filter(Boolean);
  const display =
    parts.length > 2 ? `${parts.slice(0, 2).join(', ')} +${parts.length - 2}` : text;
  return `<div class="ci-detail" title="${escapeHtml(text)}">${escapeHtml(display)}</div>`;
}

function cartItemHtml(item, { readonly = false } = {}) {
  const product = PRODUCTS.find((p) => p.id === item.productId);
  const flavors = cartFlavorEntries(item.breakdown);
  const swatchesHtml = cartFlavorSwatchesHtml(flavors, {
    varietyPlainLast: product?.rule === 'choose_variety',
  });
  const detailText = String(item.detail || '').trim();
  const detailHtml = swatchesHtml ? swatchesHtml : cartDetailHtml(detailText);
  const qty = cartLineQty(item);
  const priceHtml = `<div class="ci-price">${fmtUGX(item.lineTotal)}</div>`;

  if (readonly) {
    // Name + price on one row; swatches get the full width below so they never collide.
    return `
    <div class="cart-item cart-item--readonly">
      <div class="ci-main">
        <div class="ci-head">
          <div class="ci-name">${escapeHtml(item.name)}</div>
          ${priceHtml}
        </div>
        ${detailHtml}
      </div>
    </div>`;
  }

  const qtyHtml =
    qty > 0 ? `<div class="ci-qty" aria-label="Quantity ${qty}">${qty}</div>` : '';
  const toolsHtml = `<div class="cart-item-tools">
          <button class="cart-tool cart-edit" data-edit="${item.key}" type="button" title="Edit item" aria-label="Edit ${escapeHtml(item.name)}">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>
            </svg>
          </button>
          <button class="cart-tool cart-remove" data-remove="${item.key}" type="button" aria-label="Remove ${escapeHtml(item.name)}">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18"/>
            </svg>
          </button>
        </div>`;

  return `
    <div class="cart-item">
      ${qtyHtml}
      <div class="ci-main">
        <div class="ci-name">${escapeHtml(item.name)}</div>
        ${detailHtml}
      </div>
      <div class="cart-item-actions">
        ${priceHtml}
        ${toolsHtml}
      </div>
    </div>`;
}

function cartFactRowHtml({
  label,
  value,
  copyValue = '',
  copyLabel = '',
  truncate = false,
} = {}) {
  const full = String(value || '').trim();
  if (!full) return '';
  // Only show a copy control when callers opt in via copyValue (e.g. location/phone — not time).
  const copy = String(copyValue || '').trim();
  const copyBtn = copy
    ? `<button type="button" class="cart-copy-btn" data-copy="${escapeHtml(copy)}" aria-label="${escapeHtml(copyLabel || `Copy ${label}`)}" title="Copy">${ICON_COPY}</button>`
    : '';
  const valueClass = truncate ? 'cart-fact__value cart-fact__value--truncate' : 'cart-fact__value';
  const titleAttr = truncate ? ` title="${escapeHtml(full)}"` : '';
  return `
    <div class="cart-fact">
      <div class="cart-fact__label">${escapeHtml(label)}</div>
      <div class="cart-fact__row">
        <div class="${valueClass}"${titleAttr}>${escapeHtml(full)}</div>
        ${copyBtn}
      </div>
    </div>`;
}

function creditToggleHtml(orderIsCredit, { withId = true } = {}) {
  const idAttr = withId ? 'id="creditToggle"' : 'data-credit-toggle';
  return `
    <button
      type="button"
      ${idAttr}
      class="credit-chip${orderIsCredit ? ' is-on' : ''}"
      role="switch"
      aria-checked="${orderIsCredit ? 'true' : 'false'}"
      title="Record as unpaid credit sale (optional)"
    >
      <span class="credit-chip__dot" aria-hidden="true"></span>
      <span class="credit-chip__text">Credit</span>
    </button>`;
}

/** Confirm pill for storefront review cart — only after staff has viewed the order. */
function storeOrderConfirmPillHtml(storeOrderId) {
  const id = String(storeOrderId || '').trim();
  if (!id) return '';
  let cached = null;
  try {
    cached = window.__venusStoreOrderCacheGet?.(id) || null;
  } catch {
    cached = null;
  }
  if (!cached || cached.status === 'cancelled') return '';
  const confirmed = Boolean(cached.confirmed_at) || cached.status === 'confirmed' || cached.status === 'checked_out';
  return `
    <button
      type="button"
      class="credit-chip credit-chip--confirm${confirmed ? ' is-on' : ''}"
      data-confirm-store-order="${escapeHtml(id)}"
      ${confirmed ? 'disabled' : ''}
      aria-pressed="${confirmed ? 'true' : 'false'}"
      title="${confirmed ? 'Customer already notified' : 'Confirm order for the customer'}"
    >
      <span class="credit-chip__dot" aria-hidden="true"></span>
      <span class="credit-chip__text">${confirmed ? 'Confirmed' : 'Confirm'}</span>
    </button>`;
}

function syncReviewConfirmPills(root = document.getElementById('orderModalBody')) {
  root?.querySelectorAll('[data-confirm-store-order]').forEach((btn) => {
    const id = btn.getAttribute('data-confirm-store-order') || '';
    let cached = null;
    try {
      cached = window.__venusStoreOrderCacheGet?.(id) || null;
    } catch {
      cached = null;
    }
    if (!cached || cached.status === 'cancelled') {
      btn.hidden = true;
      return;
    }
    btn.hidden = false;
    const confirmed =
      Boolean(cached.confirmed_at) || cached.status === 'confirmed' || cached.status === 'checked_out';
    btn.classList.toggle('is-on', confirmed);
    btn.disabled = confirmed;
    btn.setAttribute('aria-pressed', confirmed ? 'true' : 'false');
    btn.title = confirmed ? 'Customer already notified' : 'Confirm order for the customer';
    const label = btn.querySelector('.credit-chip__text');
    if (label) label.textContent = confirmed ? 'Confirmed' : 'Confirm';
  });
}

function wireReviewConfirmPills(root) {
  root?.querySelectorAll('[data-confirm-store-order]').forEach((btn) => {
    if (btn.dataset.wired === '1') return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
      const panel = btn.closest('[data-store-order-panel]');
      const panelId = panel?.getAttribute('data-store-order-panel') || '';
      const orderId = btn.getAttribute('data-confirm-store-order') || '';
      if (panelId && panelId !== getActiveStoreOrderId()) return;
      if (!orderId || btn.disabled) return;
      void window.__venusConfirmStoreOrder?.(orderId);
    });
  });
}

function wireCartCopyButtons(root) {
  root.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      void copyText(btn.getAttribute('data-copy') || '', 'Copied');
    });
  });
}

/**
 * Compose cart: no programmatic scroll. Keyboard inset + ensureVisible/reveal
 * were yanking the sheet on every focus / dropdown open.
 */
function wireCartKeyboardAware(orderModalBody) {
  orderModalBody?._cartKeyboardCleanup?.();
  const modal = orderModalBody?.closest('.modal') || document.getElementById('orderModal');
  modal?.style.removeProperty('--cart-keyboard-inset');
  orderModalBody._cartKeyboardCleanup = () => {
    modal?.style.removeProperty('--cart-keyboard-inset');
  };
}

function cartEmptyHtml() {
  return `
    <div class="cart-empty">
      <div class="cart-empty__title">No items yet</div>
      <div class="cart-empty__hint">Tap Add item to start the order</div>
    </div>`;
}

function wireCartItemButtons(root) {
  root.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.edit;
      const currentCart = getCart();
      const idx = currentCart.findIndex((i) => i.key === key);
      if (idx === -1) return;
      const item = currentCart[idx];
      editingCartKey = key;
      editingCartItem = { ...item, breakdown: { ...item.breakdown } };
      configProduct = PRODUCTS.find((p) => p.id === item.productId);
      configSelection = cartItemToConfigSelection(item);
      clearManualQtyEdit();
      adjustDraftForItem(item, 1);
      currentCart.splice(idx, 1);
      setCart(currentCart);
      updateFabBadge();
      modalMode = 'config';
      renderOrderModal();
    });
  });
  root.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.remove;
      const currentCart = getCart();
      const idx = currentCart.findIndex((i) => i.key === key);
      if (idx > -1) {
        const item = currentCart[idx];
        adjustDraftForItem(item, 1);
        currentCart.splice(idx, 1);
        setCart(currentCart);
      }
      updateFabBadge();
      syncCartViewAfterItemsChange();
    });
  });
}

function syncCartViewAfterItemsChange() {
  const orderModalBody = document.getElementById('orderModalBody');
  if (!orderModalBody || modalMode !== 'cart') {
    renderOrderModal();
    return;
  }

  const cart = getCart();
  const readonly = Boolean(getActiveStoreOrderId());
  const itemsAnchor = orderModalBody.querySelector('#cartItemsList');
  if (!itemsAnchor) {
    renderOrderModal();
    return;
  }

  itemsAnchor.innerHTML = cart.length
    ? cart.map((item) => cartItemHtml(item, { readonly })).join('')
    : cartEmptyHtml();
  itemsAnchor.classList.toggle('is-empty', !cart.length);

  const countEl = orderModalBody.querySelector('.cart-section__count');
  if (countEl) countEl.textContent = cart.length ? String(cart.length) : '';

  const totalSlot = orderModalBody.querySelector('#cartTotalSlot');
  if (totalSlot) {
    totalSlot.innerHTML = cart.length
      ? `<div class="cart-total-row"><div class="ct-label">Total</div><div class="ct-val">${fmtUGX(cartTotal(cart))}</div></div>`
      : '';
  }

  wireCartItemButtons(orderModalBody);
  updateCartCheckoutState();
}

function renderComposeCartHtml({
  cart,
  orderClientName,
  orderIsCredit,
  deliveryHint,
}) {
  return `
    <div class="cart-sheet cart-sheet--compose" data-cart-mode="compose">
      <section class="cart-section cart-section--compose">
        <div class="client-picker">
          <div class="client-picker__head">
            <label for="cartClientInput">Client</label>
            ${creditToggleHtml(orderIsCredit)}
          </div>
          ${clientAutocompleteMarkup({
            inputId: 'cartClientInput',
            dropdownId: 'cartClientDropdown',
            clearId: 'cartClientClear',
            value: orderClientName,
            placeholder: 'Search or type client name…',
          })}
          <div id="cartClientCreditHintSlot">${clientCreditHintHtml(getOrderClientId(), { creditOn: orderIsCredit })}</div>
        </div>

        <div class="cart-details cart-details--compose" data-accordion data-accordion-id="cart-delivery" data-accordion-open="false">
          <button type="button" class="cart-details__summary" data-accordion-trigger>
            <span class="cart-details__title">Delivery</span>
            <span class="cart-details__hint" data-cart-delivery-hint>${escapeHtml(deliveryHint)}</span>
          </button>
          <div class="cart-details__body" data-accordion-panel>
            <div class="delivery-mini">
              <div class="delivery-input-wrap pickup">
                ${deliveryPlaceFieldMarkup({
                  inputId: 'deliveryPickupInput',
                  dropdownId: 'deliveryPickupDropdown',
                  placeholder: 'Pickup location',
                  value: checkoutPickupText,
                  icon: ICON_LOCATE,
                })}
              </div>
              <div class="delivery-input-wrap dropoff">
                ${deliveryPlaceFieldMarkup({
                  inputId: 'deliveryDestInput',
                  dropdownId: 'deliveryDestDropdown',
                  placeholder: 'Drop-off location',
                  value: checkoutDestText,
                  icon: ICON_PIN,
                })}
              </div>
              <div class="delivery-input-wrap fee">
                <span class="di-icon">${ICON_CASH}</span>
                <input type="text" inputmode="numeric" pattern="[0-9]*" class="client-input" id="deliveryFeeInputCart" placeholder="SafeBoda fee (UGX)" autocomplete="off" value="${escapeHtml(checkoutFeeValue)}" />
              </div>
              ${checkoutDistanceKm != null ? `<div class="delivery-mini-readout">${ICON_ROUTE} ${checkoutDistanceKm.toFixed(1)} km · ~${Math.round(checkoutDurationMin)} min</div>` : ''}
            </div>
          </div>
        </div>
      </section>

      <section class="cart-section cart-section--items">
        <div class="cart-section__head">
          <div class="cart-section__label">Items</div>
          <div class="cart-section__count">${cart.length ? cart.length : ''}</div>
        </div>
        <div id="cartItemsList" class="cart-items${cart.length ? '' : ' is-empty'}">${cart.length ? cart.map((item) => cartItemHtml(item)).join('') : cartEmptyHtml()}</div>
        <button class="add-item-btn" id="addItemBtn" type="button">
          <span class="add-item-btn__icon" aria-hidden="true">+</span>
          <span>Add item</span>
        </button>
        <div id="cartTotalSlot">${cart.length ? `<div class="cart-total-row"><div class="ct-label">Total</div><div class="ct-val">${fmtUGX(cartTotal(cart))}</div></div>` : ''}</div>
      </section>
    </div>`;
}

function renderReviewCartHtml({
  cart,
  orderClientName,
  orderClientId = '',
  orderIsCredit,
  orderClientPhone,
  orderDeliveryTime,
  orderDeliveryLocation = '',
  orderDeliveryEnabled = true,
  storeOrderId = '',
}) {
  // Delivery orders always carry time + location + phone; pickup is name + items only.
  const phoneDisplay = phoneNineDigits(orderClientPhone);
  const factsHtml = orderDeliveryEnabled
    ? [
        cartFactRowHtml({
          label: 'Time',
          value: orderDeliveryTime,
        }),
        cartFactRowHtml({
          label: 'Location',
          value: orderDeliveryLocation,
          copyValue: orderDeliveryLocation,
          copyLabel: 'Copy delivery location',
          truncate: true,
        }),
        cartFactRowHtml({
          label: 'Phone',
          value: phoneDisplay,
          copyValue: phoneDisplay,
          copyLabel: 'Copy phone number',
        }),
      ]
        .filter(Boolean)
        .join('')
    : '';
  const clientName = String(orderClientName || '').trim();
  const clientTextHtml = clientName
    ? `<div class="cart-review-client__text">
            <div class="cart-review-client__name">${escapeHtml(clientName)}</div>
          </div>`
    : '';
  const panelAttr = storeOrderId
    ? ` data-store-order-panel="${escapeHtml(storeOrderId)}"`
    : '';

  return `
    <div class="cart-sheet cart-sheet--review" data-cart-mode="review"${panelAttr}>
      <section class="cart-section cart-section--items cart-section--review">
        <div class="cart-items cart-items--review${cart.length ? '' : ' is-empty'}" data-cart-items>${
          cart.length
            ? cart.map((item) => cartItemHtml(item, { readonly: true })).join('')
            : cartEmptyHtml()
        }</div>
        <div data-cart-total>${cart.length ? `<div class="cart-total-row cart-total-row--review"><div class="ct-label">Total</div><div class="ct-val">${fmtUGX(cartTotal(cart))}</div></div>` : ''}</div>
      </section>

      <section class="cart-section cart-section--review-meta">
        <div class="cart-review-client${clientName ? '' : ' cart-review-client--chip-only'}">
          ${clientTextHtml}
          <div class="cart-review-chips">
            ${storeOrderConfirmPillHtml(storeOrderId)}
            ${creditToggleHtml(orderIsCredit, { withId: false })}
          </div>
        </div>
        <div data-cart-credit-hint>${clientCreditHintHtml(orderClientId, { creditOn: orderIsCredit })}</div>
        ${factsHtml ? `<div class="cart-facts">${factsHtml}</div>` : ''}
      </section>
    </div>`;
}

function renderCartView() {
  const orderModalBody = document.getElementById('orderModalBody');
  if (!orderModalBody) return;

  orderModalBody._cartKeyboardCleanup?.();

  const cart = getCart();
  const orderClientName = getOrderClientName();
  const orderClientPhone = getOrderClientPhone();
  const orderDeliveryTime = getOrderDeliveryTimeLabel();
  const orderDeliveryLocation = getOrderDeliveryLocationLabel();
  const orderDeliveryEnabled = getOrderDeliveryEnabled();
  const orderIsCredit = getOrderIsCredit();
  const storeOrderId = getActiveStoreOrderId();
  const isReview = Boolean(storeOrderId);
  const clientMissing = !orderClientName;
  const deliveryHint = checkoutDestText || checkoutPickupText || (checkoutFeeValue ? `${checkoutFeeValue} fee` : 'Optional');
  let storeOrderCancelled = false;
  if (storeOrderId) {
    try {
      // Lazy read avoids circular init issues; cache is filled by store-orders runtime.
      const cached = window.__venusStoreOrderCacheGet?.(storeOrderId);
      storeOrderCancelled = cached?.status === 'cancelled';
    } catch {
      storeOrderCancelled = false;
    }
  }

  const sheetHtml = isReview
    ? renderReviewDeckHtml(storeOrderId)
    : renderComposeCartHtml({
        cart,
        orderClientName,
        orderIsCredit,
        deliveryHint,
      });

  orderModalBody.innerHTML = `
    <div class="modal-header">
      <div class="modal-title" id="orderModalTitle">${isReview ? 'Orders' : 'Current order'}</div>
      <button class="modal-close" id="orderClose" type="button" aria-label="Close order">✕</button>
    </div>
    ${storeOrderCancelled ? '<div class="store-order-cancelled-banner" data-store-order-cancelled-banner>This order was cancelled</div>' : ''}
    ${isReview ? cartStoreOrderSwitcherHtml(storeOrderId) : ''}
    ${sheetHtml}
    <div class="modal-btns cart-footer">
      <button class="modal-btn cancel" id="cancelOrderBtn" type="button">${isReview ? 'Clear' : 'Cancel'}</button>
      <button class="modal-btn confirm" id="checkoutBtn" ${cart.length && !clientMissing ? '' : 'disabled'} type="button">${orderIsCredit ? 'Record on credit' : 'Checkout'}</button>
    </div>`;

  orderModalBody.dataset.cartMode = isReview ? 'review' : 'compose';

  if (isReview) {
    const track = orderModalBody.querySelector('[data-cart-review-track]');
    setReviewDeckIndex(track, storeOrderId, { instant: true });
  }

  if (!isReview) {
    wireGsapAccordions(orderModalBody);
  }
  document.getElementById('orderClose')?.addEventListener('click', closeOrderModal);
  wireCartStoreOrderSwitcher(orderModalBody);

  if (!isReview) {
    wireClientAutocomplete({
      inputId: 'cartClientInput',
      dropdownId: 'cartClientDropdown',
      clearId: 'cartClientClear',
      showAllOnFocus: true,
      onChange: (name, client) => {
        if (client) {
          setOrderClient(client);
        } else if (!name) {
          setOrderClient(null);
          if (getOrderIsCredit()) setOrderIsCredit(false);
        } else {
          const meta = getOrderMeta();
          meta.clientName = name;
          meta.clientId = '';
          setOrderMeta(meta);
        }
        updateCartCheckoutState();
      },
    });
  }

  document.getElementById('creditToggle')?.addEventListener('click', () => {
    setOrderIsCredit(!getOrderIsCredit());
    if (getActiveStoreOrderId()) captureStoreOrderSession();
    updateCartCheckoutState();
  });
  if (isReview) {
    wireReviewCreditToggles(orderModalBody);
    wireReviewConfirmPills(orderModalBody);
  }

  if (!isReview) {
    document.getElementById('addItemBtn')?.addEventListener('click', () => {
      modalMode = 'pick';
      renderOrderModal();
    });

    wireDeliveryAutocompletes();
    if (!pickupAutoRequested) {
      pickupAutoRequested = true;
      autoFillPickupLocation();
    }
    document.getElementById('deliveryFeeInputCart')?.addEventListener('input', (e) => {
      checkoutFeeValue = e.target.value;
      checkoutFeeManuallyEdited = true;
      updateCartDeliveryHint();
    });
  } else {
    wireCartCopyButtons(orderModalBody);
  }

  document.getElementById('cancelOrderBtn')?.addEventListener('click', () => {
    const activeId = getActiveStoreOrderId();
    const body = document.getElementById('orderModalBody');
    const track = body?.querySelector('[data-cart-review-track]');
    if (activeId) {
      void window.__venusReleaseStoreOrderFromCart?.(activeId);
      const clearedPanel = track?.querySelector(
        `[data-store-order-panel="${CSS.escape(activeId)}"]`,
      );
      clearedPanel?.remove();
      const nextId = peekNextStoreOrderSessionId(activeId);
      if (nextId && restoreStoreOrderSession(nextId)) {
        window.__venusRenderStoreOrderUi?.();
        if (track?.querySelector(`[data-store-order-panel="${CSS.escape(nextId)}"]`)) {
          // Panel removed mid-deck — jump index instantly so layout stays put.
          setReviewDeckIndex(track, nextId, { instant: true });
          syncReviewCartChrome(body);
        } else {
          renderOrderModal();
        }
        const nextName =
          window.__venusStoreOrderCacheGet?.(nextId)?.customer_name || 'next order';
        showToast(`Cleared — now viewing ${nextName}`);
        return;
      }
    } else {
      composeDraft = null;
    }
    setCart([]);
    setOrderMeta(emptyOrderMeta());
    resetDraftStock();
    resetCheckoutDelivery();
    updateFabBadge();
    window.__venusRenderStoreOrderUi?.();
    closeOrderModal();
  });
  document.getElementById('checkoutBtn')?.addEventListener('click', checkout);
  wireCartItemButtons(orderModalBody);
  wireCartKeyboardAware(orderModalBody);
}

function renderPickView() {
  const orderModalBody = document.getElementById('orderModalBody');
  if (!orderModalBody) return;

  orderModalBody.innerHTML = `
    <div class="modal-header">
      <div class="modal-title">Add item</div>
      <button class="modal-close" id="orderClose" type="button" data-order-close>✕</button>
    </div>
    ${renderProductPickPanel()}
    <div class="modal-btns pick-footer">
      <button class="modal-btn cancel" id="backToCart" type="button">Back to order</button>
    </div>`;

  document.getElementById('orderClose')?.addEventListener('click', closeOrderModal);
  document.getElementById('backToCart')?.addEventListener('click', () => {
    modalMode = 'cart';
    renderOrderModal();
  });
  wireProductPickButtons(orderModalBody, (productId, row) => {
    pressButton(row);
    configProduct = PRODUCTS.find((p) => p.id === productId);
    configSelection = {};
    clearManualQtyEdit();
    modalMode = 'config';
    renderOrderModal();
  });
}

function renderConfigView() {
  const orderModalBody = document.getElementById('orderModalBody');
  const p = configProduct;
  if (!orderModalBody || !p) return;

  const flavorList = orderModalBody.querySelector('.flavor-list');
  const scrollTop = flavorList?.scrollTop ?? 0;
  const activeFlavor = document.activeElement?.closest?.('[data-flavor]')?.dataset?.flavor;
  const activeStep = document.activeElement?.matches?.('button.flavor-step')
    ? document.activeElement.dataset.pdir
    : null;
  const prevMeter = orderModalBody.querySelector('.flavor-meter__fill');
  const fromMeter = prevMeter ? readFlavorMeterScale(prevMeter) : 0;
  const hadMeter = Boolean(prevMeter);

  orderModalBody.innerHTML = renderProductConfigView(p, configSelection, draftStock, Boolean(editingCartKey), {
    closeId: 'orderClose',
    backId: 'backBtn',
    confirmId: 'addToOrderBtn',
  });
  wireConfigEvents();

  const nextList = orderModalBody.querySelector('.flavor-list');
  if (nextList) nextList.scrollTop = scrollTop;

  const qtyEdit = orderModalBody.querySelector('[data-qty-edit]');
  if (qtyEdit) {
    qtyEdit.focus({ preventScroll: true });
    const len = qtyEdit.value.length;
    qtyEdit.setSelectionRange(len, len);
  } else if (activeFlavor != null) {
    const sel = activeStep != null
      ? `button.flavor-step[data-pick="${activeFlavor}"][data-pdir="${activeStep}"]`
      : `[data-flavor="${activeFlavor}"]`;
    orderModalBody.querySelector(sel)?.focus?.({ preventScroll: true });
  }

  const fill = orderModalBody.querySelector('.flavor-meter__fill');
  if (fill) {
    const toMeter = Math.max(0, Math.min(1, parseFloat(fill.dataset.meter) || 0));
    animateFlavorMeter(fill, { from: hadMeter ? fromMeter : 0, to: toMeter });
  }
}

function wireConfigEvents() {
  const orderModalBody = document.getElementById('orderModalBody');
  if (!orderModalBody) return;

  wireProductConfigView(orderModalBody, {
    configSelection,
    closeId: 'orderClose',
    backId: 'backBtn',
    confirmId: 'addToOrderBtn',
    onClose: closeOrderModal,
    onBack: () => {
      if (editingCartItem) {
        adjustDraftForItem(editingCartItem, -1);
        const currentCart = getCart();
        currentCart.push(editingCartItem);
        setCart(currentCart);
        editingCartKey = null;
        editingCartItem = null;
        updateFabBadge();
      }
      modalMode = getCart().length ? 'cart' : 'pick';
      renderOrderModal();
    },
    onConfirm: addConfiguredItemToCart,
    onRerender: renderConfigView,
  });
}

function addConfiguredItemToCart() {
  const p = configProduct;
  if (!p) return;

  if (editingCartKey) {
    editingCartKey = null;
    editingCartItem = null;
  }

  const { breakdown, lineTotal, detail } = buildLineFromConfig(p, configSelection);

  adjustDraftForItem({ breakdown, stockDeferred: false }, -1);

  const cart = getCart();
  cart.push({
    key: `${p.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    productId: p.id,
    name: p.name,
    detail,
    breakdown,
    lineTotal,
  });
  setCart(cart);
  updateFabBadge();
  modalMode = 'cart';
  renderOrderModal();
}

async function patchInventoryRemote(ids) {
  await Promise.all(
    ids.map(async (id) => {
      const res = await sbFetch(`inventory?category_id=eq.${id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ stock: inventory[id], updated_at: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error(`Supabase ${res.status}`);
    }),
  );
}

async function resolveCheckoutClientId(orderClientName) {
  let clientId = getOrderClientId();
  if (clientId) {
    const byId = clients.find((c) => c.id === clientId);
    if (byId?.id) return byId.id;
  }
  return resolveClientId(orderClientName);
}

async function saveCheckoutDelivery({ clientId, orderClientName, saleId, snapshot }) {
  const delRes = await sbFetch('deliveries', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      client_id: clientId,
      client_name: orderClientName || null,
      sale_id: saleId || null,
      origin_lat: snapshot.origin.lat,
      origin_lng: snapshot.origin.lng,
      origin_label: snapshot.pickupText || null,
      dest_lat: snapshot.dest.lat,
      dest_lng: snapshot.dest.lng,
      dest_label: snapshot.destText || null,
      distance_km: Number(snapshot.distanceKm.toFixed(3)),
      duration_min: snapshot.durationMin != null ? Number(snapshot.durationMin.toFixed(1)) : null,
      fee_ugx: snapshot.fee,
      predicted_fee_ugx: snapshot.predictedFee != null ? snapshot.predictedFee : null,
      fee_was_edited: !!snapshot.feeWasEdited,
    }),
  });
  if (!delRes.ok) throw new Error(`Supabase ${delRes.status}`);
  const delRows = await delRes.json();
  if (delRows[0]) await dataStore.appendDelivery(delRows[0]);
}

function markCheckoutDeliveryFailed() {
  if (modalMode !== 'success' || !lastCheckoutReceipt?.delivery) return;
  lastCheckoutReceipt.delivery = null;
  lastCheckoutReceipt.deliveryFailed = true;
  renderSuccessView({ animate: false });
}

function markCheckoutDeliverySaved() {
  if (modalMode !== 'success' || !lastCheckoutReceipt?.delivery?.pending) return;
  lastCheckoutReceipt.delivery.pending = false;
  renderSuccessView({ animate: false });
}

async function finishCheckoutBackground({
  clientId,
  orderClientName,
  saleId,
  deliverySnapshot,
  inventoryIds,
}) {
  try {
    const { updateTodayStrip } = await import('./home.js');
    updateTodayStrip();
  } catch (e) {
    console.error('updateTodayStrip failed', e);
  }

  if (inventoryIds?.length) {
    try {
      await patchInventoryRemote(inventoryIds);
      void dataStore.persistCurrent('inventory');
    } catch (e) {
      console.error('inventory sync failed', e);
      showToast('Order saved — stock sync pending', true);
    }
  }

  if (!deliverySnapshot) return;

  try {
    await saveCheckoutDelivery({
      clientId,
      orderClientName,
      saleId,
      snapshot: deliverySnapshot,
    });
    markCheckoutDeliverySaved();
  } catch (e) {
    console.error('save delivery failed', e);
    markCheckoutDeliveryFailed();
    showToast('Order saved — delivery not logged', true);
  }
}

function showCheckoutSuccess({
  cart,
  total,
  orderClientName,
  orderIsCredit,
  deliverySnapshot,
}) {
  lastCheckoutReceipt = {
    items: cart.map((item) => ({
      name: item.name,
      detail: item.detail,
      lineTotal: item.lineTotal,
    })),
    total,
    clientName: orderClientName,
    isCredit: orderIsCredit,
    delivery: deliverySnapshot
      ? {
          pickup: deliverySnapshot.pickupText,
          dest: deliverySnapshot.destText,
          distanceKm: deliverySnapshot.distanceKm,
          durationMin: deliverySnapshot.durationMin,
          fee: deliverySnapshot.fee,
          pending: true,
        }
      : null,
    deliveryFailed: false,
  };

  setCart([]);
  setOrderMeta(emptyOrderMeta());
  resetCheckoutDelivery();
  updateFabBadge();
  renderStockGlance();

  modalMode = 'success';

  const orderModal = document.getElementById('orderModal');
  if (orderModal && !isModalOpen(orderModal)) openModal(orderModal);
  renderOrderModal();
}

async function checkout() {
  if (checkoutInFlight) return;

  const cart = getCart();
  const orderClientName = getOrderClientName();
  const orderClientId = getOrderClientId();
  const orderIsCredit = getOrderIsCredit();
  const storeOrderId = getActiveStoreOrderId();

  if (cart.length === 0) return;
  if (!orderClientName) {
    showToast('Client name is required', true);
    return;
  }

  if (orderIsCredit && orderClientId) {
    const openDebt = clientOpenCreditSummary(orderClientId);
    if (openDebt) {
      const ok = await showConfirm(
        `${orderClientName} already owes ${fmtUGX(openDebt.totalUgx)} across ${openDebt.count} order${openDebt.count === 1 ? '' : 's'}. Record another credit?`,
      );
      if (!ok) return;
    }
  }

  checkoutInFlight = true;

  const total = cartTotal(cart);
  showCheckoutProcessing({
    total,
    itemCount: cart.length,
    clientName: orderClientName,
    isCredit: orderIsCredit,
  });

  const mergedBreakdown = {};
  cart.forEach((item) => {
    Object.entries(item.breakdown || {}).forEach(([id, qty]) => {
      mergedBreakdown[id] = (mergedBreakdown[id] || 0) + qty;
    });
  });
  const inventoryIds = Object.keys(mergedBreakdown);
  const inventorySnapshot = snapshotInventory(inventoryIds);

  try {
    for (const [id, qty] of Object.entries(mergedBreakdown)) {
      const previous = inventory[id];
      inventory[id] = Math.max(0, inventory[id] - qty);
      const el = document.getElementById(`inv-count-${id}`);
      if (el) el.textContent = inventory[id];
      void notifyStockCrossing(id, previous, inventory[id]);
    }
    resetDraftStock();
    renderStockGlance();
    void dataStore.persistCurrent('inventory');

    const clientId = await resolveCheckoutClientId(orderClientName);

    const items = cart.map((i) => ({
      product_id: i.productId,
      product_name: i.name,
      detail: i.detail,
      line_total: i.lineTotal,
      breakdown: i.breakdown,
    }));

    const res = await sbFetch('sales', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        items,
        total_ugx: total,
        client_id: clientId,
        is_credit: orderIsCredit,
        credit_cleared: !orderIsCredit,
        amount_paid_ugx: orderIsCredit ? 0 : total,
        cleared_at: null,
      }),
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    const saleRows = await res.json();
    if (saleRows?.[0]) void dataStore.appendSale(saleRows[0]);

    if (orderIsCredit) {
      void notifyCreditSale({
        clientName: orderClientName,
        totalLabel: fmtUGX(total),
      });
    }

    if (storeOrderId) {
      dropStoreOrderSession(storeOrderId);
      try {
        const { markStoreOrderCheckedOut } = await import('./store-orders.js');
        await markStoreOrderCheckedOut(storeOrderId, saleRows?.[0]?.id || null);
      } catch (e) {
        console.error('store order checkout mark failed', e);
      }
    }

    const feeVal = parseInt(checkoutFeeValue, 10);
    const deliveryAttempted =
      checkoutOrigin && checkoutDest && checkoutDistanceKm != null && feeVal > 0;
    // Recompute once at confirm so we still log an estimate even if autofill never ran
    // (e.g. model became ready mid-flow); prefer the autofilled snapshot when present.
    let predictedAtCheckout = checkoutPredictedFee;
    if (predictedAtCheckout == null && checkoutDistanceKm != null) {
      predictedAtCheckout = predictSafeBodaFee(checkoutDistanceKm, {
        durationMin: checkoutDurationMin,
        at: new Date(),
      });
    }
    const feeWasEdited =
      checkoutFeeManuallyEdited &&
      (predictedAtCheckout == null || feeVal !== predictedAtCheckout);
    const deliverySnapshot = deliveryAttempted
      ? {
          origin: { ...checkoutOrigin },
          dest: { ...checkoutDest },
          pickupText: checkoutPickupText,
          destText: checkoutDestText,
          distanceKm: checkoutDistanceKm,
          durationMin: checkoutDurationMin,
          fee: feeVal,
          predictedFee: predictedAtCheckout,
          feeWasEdited,
        }
      : null;

    lastCheckoutProcessing = null;
    if (!storeOrderId) composeDraft = null;
    showCheckoutSuccess({
      cart,
      total,
      orderClientName,
      orderIsCredit,
      deliverySnapshot,
    });

    void finishCheckoutBackground({
      clientId,
      orderClientName,
      saleId: saleRows?.[0]?.id || null,
      deliverySnapshot,
      inventoryIds,
    });
  } catch (e) {
    console.error('checkout failed', e);
    applyInventorySnapshot(inventorySnapshot);
    resetDraftStock();
    renderStockGlance();
    void dataStore.persistCurrent('inventory');
    restoreCheckoutCartView();
    showToast('Checkout failed — check connection', true);
    updateCartCheckoutState();
  } finally {
    checkoutInFlight = false;
  }
}

export function wireOrders() {
  const orderModal = document.getElementById('orderModal');
  window.__venusRefreshStoreOrderCartSwitcher = refreshStoreOrderCartSwitcher;
  window.__venusSyncReviewCartChrome = () => {
    const body = document.getElementById('orderModalBody');
    if (body) syncReviewCartChrome(body);
  };

  orderModal?.addEventListener('click', (e) => {
    if (e.target === orderModal) closeOrderModal();
  });

  document.getElementById('fabNewOrder')?.addEventListener('click', () => {
    lastCheckoutReceipt = null;
    lastCheckoutProcessing = null;
    activateComposeCart();
    const cart = getCart();
    modalMode = cart.length ? 'cart' : 'pick';
    renderOrderModal();
    if (orderModal) openModal(orderModal);
  });

  document.getElementById('fabReviewOrders')?.addEventListener('click', () => {
    lastCheckoutReceipt = null;
    lastCheckoutProcessing = null;
    if (activateReviewCart()) {
      openLoadedOrderModal();
      return;
    }
    void window.__venusOpenAcceptedStoreOrderFromFab?.();
  });

  document.addEventListener('store-order:cancelled', (event) => {
    const cancelledId = event.detail?.orderId;
    if (!cancelledId || getActiveStoreOrderId() !== cancelledId) return;
    if (modalMode === 'cart') {
      const body = document.getElementById('orderModalBody');
      if (body && !body.querySelector('[data-store-order-cancelled-banner]')) {
        const banner = document.createElement('div');
        banner.className = 'store-order-cancelled-banner';
        banner.dataset.storeOrderCancelledBanner = '1';
        banner.textContent = event.detail?.byStaff
          ? 'You cancelled this order'
          : 'This order was cancelled';
        body.querySelector('.modal-header')?.insertAdjacentElement('afterend', banner);
      }
    }
    // Staff cancel already toasts from the Order stack action.
    if (!event.detail?.byStaff) {
      showToast('This storefront order was cancelled', true);
    }
  });

  updateFabBadge();
}

/**
 * Load a storefront order into the active cart without reserving draft stock.
 * Inventory only changes on Checkout.
 */
export function applyStorefrontOrderToCart({
  storeOrderId,
  customerName,
  phoneE164,
  deliveryEnabled = true,
  delivery = {},
  deliveryFeeUgx = null,
  deliveryDistanceKm = null,
  deliveryDurationMin = null,
  locationLabel = '',
  locationLat = null,
  locationLng = null,
  cartLines = [],
} = {}) {
  resetDraftStock();
  setCart(Array.isArray(cartLines) ? cartLines : []);

  const wantsDelivery = deliveryEnabled !== false;
  const deliveryLabel = wantsDelivery ? String(delivery.label || '').trim() : '';
  const locationText = wantsDelivery ? String(locationLabel || '').trim() : '';
  setOrderMeta(
    emptyOrderMeta({
      clientName: String(customerName || '').trim(),
      clientId: '',
      isCredit: false,
      clientPhone: String(phoneE164 || '').trim(),
      deliveryEnabled: wantsDelivery,
      deliveryTimeLabel: deliveryLabel,
      deliveryLocationLabel: locationText,
      deliveryTimeMode: wantsDelivery ? String(delivery.mode || '') : '',
      deliveryDeliverAt: wantsDelivery ? String(delivery.deliverAt || '') : '',
      storeOrderId: String(storeOrderId || ''),
    }),
  );

  resetCheckoutDelivery();

  if (wantsDelivery) {
    checkoutDestText = locationText;
    if (
      locationLat != null &&
      locationLng != null &&
      !Number.isNaN(Number(locationLat)) &&
      !Number.isNaN(Number(locationLng))
    ) {
      checkoutDest = { lat: Number(locationLat), lng: Number(locationLng) };
    }
    if (deliveryFeeUgx != null && !Number.isNaN(Number(deliveryFeeUgx))) {
      checkoutFeeValue = String(Math.round(Number(deliveryFeeUgx)));
      checkoutFeeManuallyEdited = true;
    }
    if (deliveryDistanceKm != null && !Number.isNaN(Number(deliveryDistanceKm))) {
      checkoutDistanceKm = Number(deliveryDistanceKm);
    }
    if (deliveryDurationMin != null && !Number.isNaN(Number(deliveryDurationMin))) {
      checkoutDurationMin = Number(deliveryDurationMin);
    }
    const at = delivery?.deliverAt ? new Date(delivery.deliverAt) : new Date();
    if (checkoutPredictedFee == null && checkoutDistanceKm != null) {
      checkoutPredictedFee = predictSafeBodaFee(checkoutDistanceKm, {
        durationMin: checkoutDurationMin,
        at: Number.isNaN(at.getTime()) ? new Date() : at,
      });
    }
  }

  pickupAutoRequested = false;
  updateFabBadge();
  if (storeOrderId) {
    captureStoreOrderSession();
  }
}

export function openLoadedOrderModal() {
  lastCheckoutReceipt = null;
  lastCheckoutProcessing = null;
  modalMode = getCart().length ? 'cart' : 'pick';
  const orderModal = document.getElementById('orderModal');

  // Keep the review shell mounted: slide or append instead of replacing the cart.
  if (getActiveStoreOrderId() && softUpdateOpenReviewDeck()) {
    if (orderModal) openModal(orderModal);
    return;
  }

  renderOrderModal();
  if (orderModal) openModal(orderModal);
  // Ensure drop-off field shows after render, then compute route if coords exist.
  if (checkoutDestText) setDeliveryFieldValue('deliveryDestInput', checkoutDestText);
  if (checkoutFeeValue) {
    const feeInput = document.getElementById('deliveryFeeInputCart');
    if (feeInput) feeInput.value = checkoutFeeValue;
  }
  updateCartDeliveryHint();
  if (checkoutDest && !checkoutOrigin) {
    pickupAutoRequested = true;
    autoFillPickupLocation();
  } else if (checkoutOrigin && checkoutDest) {
    computeCheckoutDistance();
  }
}

export function renderProductList() {
  const productList = document.getElementById('productList');
  if (!productList) return;

  productList.innerHTML = PRODUCTS.map((p) => productPickButtonHtml(p)).join('');

  wireProductPickButtons(productList, (productId, row) => {
    pressButton(row);
    openOrderModal(productId);
  });
}
