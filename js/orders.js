import { dataStore } from './store/index.js';
import { sbFetch } from './api.js';
import {
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
import { escapeHtml, fmtUGX, showConfirm, showToast } from './utils.js';
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
  const cart = getCart();
  const fabBadge = document.getElementById('fabBadge');
  if (!fabBadge) return;
  if (cart.length > 0) {
    fabBadge.style.display = 'flex';
    fabBadge.textContent = cart.length;
  } else {
    fabBadge.style.display = 'none';
  }
  pulseFabBadge(cart.length);
}

function closeOrderModal() {
  if (modalMode === 'processing') return;

  if (modalMode === 'success') {
    dismissSuccessView();
    return;
  }

  if (editingCartItem) {
    Object.entries(editingCartItem.breakdown).forEach(([id, qty]) => {
      draftStock[id] -= qty;
    });
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
              <div class="ci-detail">${escapeHtml(item.detail)}</div>
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
        <button class="modal-btn cancel" id="checkoutSuccessNewBtn" type="button">New order</button>
        <button class="modal-btn confirm" id="checkoutSuccessDoneBtn" type="button">Done</button>
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
  const checkoutBtn = document.getElementById('checkoutBtn');
  if (checkoutBtn) {
    checkoutBtn.disabled = !cart.length || clientMissing;
    checkoutBtn.textContent = orderIsCredit ? 'Record on credit' : 'Checkout';
  }
  const creditChip = document.getElementById('creditToggle');
  if (creditChip) {
    creditChip.classList.toggle('is-on', orderIsCredit);
    creditChip.setAttribute('aria-checked', orderIsCredit ? 'true' : 'false');
  }

  const totalVal = document.querySelector('#orderModalBody .cart-total-row .ct-val');
  if (totalVal) totalVal.textContent = fmtUGX(cartTotal(cart));

  const hintHost = document.getElementById('cartClientCreditHintSlot');
  if (hintHost) {
    hintHost.innerHTML = clientCreditHintHtml(orderClientId, { creditOn: orderIsCredit });
  }
}

function cartItemHtml(item) {
  return `
    <div class="cart-item">
      <div class="ci-main">
        <div class="ci-name">${escapeHtml(item.name)}</div>
        <div class="ci-detail">${escapeHtml(item.detail)}</div>
      </div>
      <div class="cart-item-actions">
        <div class="ci-price">${fmtUGX(item.lineTotal)}</div>
        <div class="cart-item-tools">
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
        </div>
      </div>
    </div>`;
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
      Object.entries(item.breakdown).forEach(([id, qty]) => {
        draftStock[id] += qty;
      });
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
        Object.entries(item.breakdown).forEach(([id, qty]) => {
          draftStock[id] += qty;
        });
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
  const itemsAnchor = orderModalBody.querySelector('#cartItemsList');
  if (!itemsAnchor) {
    renderOrderModal();
    return;
  }

  itemsAnchor.innerHTML = cart.length ? cart.map(cartItemHtml).join('') : cartEmptyHtml();
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

function renderCartView() {
  const orderModalBody = document.getElementById('orderModalBody');
  if (!orderModalBody) return;

  const cart = getCart();
  const orderClientName = getOrderClientName();
  const orderIsCredit = getOrderIsCredit();
  const clientMissing = !orderClientName;
  const hasDelivery = Boolean(checkoutPickupText || checkoutDestText || checkoutFeeValue);
  const deliveryHint = checkoutDestText || checkoutPickupText || (checkoutFeeValue ? `${checkoutFeeValue} fee` : 'Optional');

  orderModalBody.innerHTML = `
    <div class="modal-header">
      <div class="modal-title" id="orderModalTitle">Current order</div>
      <button class="modal-close" id="orderClose" type="button" aria-label="Close order">✕</button>
    </div>
    <div class="cart-sheet">
      <section class="cart-section cart-section--items">
        <div class="cart-section__head">
          <div class="cart-section__label">Items</div>
          <div class="cart-section__count">${cart.length ? cart.length : ''}</div>
        </div>
        <div id="cartItemsList" class="cart-items${cart.length ? '' : ' is-empty'}">${cart.length ? cart.map(cartItemHtml).join('') : cartEmptyHtml()}</div>
        <button class="add-item-btn" id="addItemBtn" type="button">
          <span class="add-item-btn__icon" aria-hidden="true">+</span>
          <span>Add item</span>
        </button>
        <div id="cartTotalSlot">${cart.length ? `<div class="cart-total-row"><div class="ct-label">Total</div><div class="ct-val">${fmtUGX(cartTotal(cart))}</div></div>` : ''}</div>
      </section>

      <section class="cart-section cart-section--client">
        <div class="client-picker">
          <div class="client-picker__head">
            <label for="cartClientInput">Client</label>
            <button
              type="button"
              id="creditToggle"
              class="credit-chip${orderIsCredit ? ' is-on' : ''}"
              role="switch"
              aria-checked="${orderIsCredit ? 'true' : 'false'}"
              title="Record as unpaid credit sale (optional)"
            >
              <span class="credit-chip__dot" aria-hidden="true"></span>
              <span class="credit-chip__text">Credit</span>
            </button>
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
      </section>

      <div class="cart-details" data-accordion data-accordion-id="cart-delivery"${hasDelivery ? ' data-accordion-open="true"' : ''}>
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
    </div>
    <div class="modal-btns cart-footer">
      <button class="modal-btn cancel" id="cancelOrderBtn" type="button">Cancel</button>
      <button class="modal-btn confirm" id="checkoutBtn" ${cart.length && !clientMissing ? '' : 'disabled'} type="button">${orderIsCredit ? 'Record on credit' : 'Checkout'}</button>
    </div>`;

  wireGsapAccordions(orderModalBody);
  document.getElementById('orderClose')?.addEventListener('click', closeOrderModal);
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
  document.getElementById('creditToggle')?.addEventListener('click', () => {
    setOrderIsCredit(!getOrderIsCredit());
    updateCartCheckoutState();
  });
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
  document.getElementById('cancelOrderBtn')?.addEventListener('click', () => {
    setCart([]);
    setOrderMeta({ clientName: '', clientId: '', isCredit: false });
    resetDraftStock();
    resetCheckoutDelivery();
    updateFabBadge();
    closeOrderModal();
  });
  document.getElementById('checkoutBtn')?.addEventListener('click', checkout);
  wireCartItemButtons(orderModalBody);
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
        Object.entries(editingCartItem.breakdown).forEach(([id, qty]) => {
          draftStock[id] -= qty;
        });
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

  Object.entries(breakdown).forEach(([id, qty]) => {
    draftStock[id] -= qty;
  });

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
  setOrderMeta({ clientName: '', clientId: '', isCredit: false });
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
    Object.entries(item.breakdown).forEach(([id, qty]) => {
      mergedBreakdown[id] = (mergedBreakdown[id] || 0) + qty;
    });
  });
  const inventoryIds = Object.keys(mergedBreakdown);
  const inventorySnapshot = snapshotInventory(inventoryIds);

  try {
    for (const [id, qty] of Object.entries(mergedBreakdown)) {
      inventory[id] = Math.max(0, inventory[id] - qty);
      const el = document.getElementById(`inv-count-${id}`);
      if (el) el.textContent = inventory[id];
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

  orderModal?.addEventListener('click', (e) => {
    if (e.target === orderModal) closeOrderModal();
  });

  document.getElementById('fabNewOrder')?.addEventListener('click', () => {
    lastCheckoutReceipt = null;
    lastCheckoutProcessing = null;
    const cart = getCart();
    modalMode = cart.length ? 'cart' : 'pick';
    renderOrderModal();
    if (orderModal) openModal(orderModal);
  });

  updateFabBadge();
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
