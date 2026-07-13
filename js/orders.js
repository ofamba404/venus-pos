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
} from './delivery.js';
import {
  deliveryPlaceFieldMarkup,
  setDeliveryFieldValue,
  wireDeliveryPlacesInputs,
} from './places-autocomplete.js';
import { adjustStock, renderStockGlance } from './inventory.js';
import {
  buildLineFromConfig,
  productDetailLabel,
  productPickButtonHtml,
  renderProductConfigView,
  renderProductPickPanel,
  wireProductConfigView,
  wireProductPickButtons,
} from './product-config.js';
import {
  animateCheckoutSuccess,
  animateModalContent,
  closeModal,
  isModalOpen,
  openModal,
  pressButton,
  pulseFabBadge,
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
  setCart,
  setOrderMeta,
} from './state.js';
import { escapeHtml, fmtUGX, showToast } from './utils.js';

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
let pickupAutoRequested = false;
let lastCheckoutReceipt = null;
let lastOrderModalMode = null;
let checkoutInFlight = false;

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
  pickupAutoRequested = false;
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

  if (modalMode === 'cart') renderCartView();
  else if (modalMode === 'pick') renderPickView();
  else if (modalMode === 'config') renderConfigView();
  else if (modalMode === 'success') renderSuccessView();

  const orderModal = document.getElementById('orderModal');
  const orderModalBody = document.getElementById('orderModalBody');
  if (orderModalBody) orderModalBody.dataset.mode = modalMode;
  if (orderModalBody && modalMode !== 'success' && !isCartRefresh && isModalOpen(orderModal)) {
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
  modalMode = 'cart';
  const orderModal = document.getElementById('orderModal');
  if (orderModal) closeModal(orderModal);
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
    modalMode = 'pick';
    renderOrderModal();
  });

  if (animate) animateCheckoutSuccess(orderModalBody);
}

export function openOrderModal(productId) {
  configProduct = PRODUCTS.find((p) => p.id === productId);
  configSelection = {};
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

function computeCheckoutDistance() {
  if (!checkoutOrigin || !checkoutDest) {
    checkoutDistanceKm = null;
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
        } else {
          checkoutDistanceKm = null;
          checkoutDurationMin = null;
        }
        updateCheckoutDistanceReadout();
      },
    );
  });
}

function wireDeliveryAutocompletes() {
  wireDeliveryPlacesInputs(
    'deliveryPickupInput',
    'deliveryPickupDropdown',
    'deliveryDestInput',
    'deliveryDestDropdown',
    {
    onPickupSelect: ({ lat, lng, label }) => {
      checkoutOrigin = { lat, lng };
      checkoutPickupText = label;
      setDeliveryFieldValue('deliveryPickupInput', label);
      computeCheckoutDistance();
    },
    onDestSelect: ({ lat, lng, label }) => {
      checkoutDest = { lat, lng };
      checkoutDestText = label;
      setDeliveryFieldValue('deliveryDestInput', label);
      computeCheckoutDistance();
    },
    onPickupFocus: () => {},
    onDestFocus: () => {},
    onPickupInput: (value) => {
      checkoutPickupText = value;
      if (!value) {
        checkoutOrigin = null;
        checkoutDistanceKm = null;
        updateCheckoutDistanceReadout();
      }
    },
    onDestInput: (value) => {
      checkoutDestText = value;
      if (!value) {
        checkoutDest = null;
        checkoutDistanceKm = null;
        updateCheckoutDistanceReadout();
      }
    },
  });
}

function autoFillPickupLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      checkoutOrigin = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      loadGoogleMaps(() => {
        new google.maps.Geocoder().geocode({ location: checkoutOrigin }, (results, status) => {
          checkoutPickupText =
            status === 'OK' && results[0]
              ? results[0].formatted_address
              : `${checkoutOrigin.lat.toFixed(5)}, ${checkoutOrigin.lng.toFixed(5)}`;
          setDeliveryFieldValue('deliveryPickupInput', checkoutPickupText);
          computeCheckoutDistance();
        });
      });
    },
    () => {},
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

function updateCartCheckoutState() {
  const cart = getCart();
  const orderClientName = getOrderClientName();
  const orderIsCredit = getOrderIsCredit();
  const creditBlocked = orderIsCredit && !orderClientName;
  const checkoutBtn = document.getElementById('checkoutBtn');
  if (checkoutBtn) {
    checkoutBtn.disabled = !cart.length || creditBlocked;
    checkoutBtn.textContent = orderIsCredit ? 'Record on credit' : 'Checkout';
  }
  const creditChip = document.getElementById('creditToggle');
  if (creditChip) {
    creditChip.classList.toggle('is-on', orderIsCredit);
    creditChip.setAttribute('aria-checked', orderIsCredit ? 'true' : 'false');
  }
  const creditWarning = document.getElementById('cartCreditWarning');
  if (creditWarning) creditWarning.hidden = !(orderIsCredit && !orderClientName);

  const totalVal = document.querySelector('#orderModalBody .cart-total-row .ct-val');
  if (totalVal) totalVal.textContent = fmtUGX(cartTotal(cart));
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
  const creditBlocked = orderIsCredit && !orderClientName;
  const hasDetails = Boolean(
    orderClientName || orderIsCredit || checkoutPickupText || checkoutDestText || checkoutFeeValue,
  );

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

      <div class="cart-details" data-accordion data-accordion-id="cart-client-delivery"${hasDetails ? ' data-accordion-open="true"' : ''}>
        <button type="button" class="cart-details__summary" data-accordion-trigger>
          <span class="cart-details__title">Client &amp; delivery</span>
          <span class="cart-details__hint">${orderClientName ? escapeHtml(orderClientName) : 'Optional'}</span>
        </button>
        <div class="cart-details__body" data-accordion-panel>
          <div class="client-picker">
            <div class="client-picker__head">
              <label for="cartClientInput">Client</label>
              <button
                type="button"
                id="creditToggle"
                class="credit-chip${orderIsCredit ? ' is-on' : ''}"
                role="switch"
                aria-checked="${orderIsCredit ? 'true' : 'false'}"
                title="Record as unpaid credit sale"
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
              placeholder: 'Search or type a new name…',
            })}
            <div class="credit-warning" id="cartCreditWarning" ${orderIsCredit && !orderClientName ? '' : 'hidden'}>Select a client before recording credit</div>
          </div>
          <div class="delivery-mini">
            <div class="delivery-mini-label">Delivery</div>
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
      <button class="modal-btn confirm" id="checkoutBtn" ${cart.length && !creditBlocked ? '' : 'disabled'} type="button">${orderIsCredit ? 'Record on credit' : 'Checkout'}</button>
    </div>`;

  wireGsapAccordions(orderModalBody);
  document.getElementById('orderClose')?.addEventListener('click', closeOrderModal);
  wireClientAutocomplete({
    inputId: 'cartClientInput',
    dropdownId: 'cartClientDropdown',
    clearId: 'cartClientClear',
    showAllOnFocus: true,
    maxResults: 8,
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
      const hint = orderModalBody.querySelector('.cart-details__hint');
      if (hint) hint.textContent = name || 'Optional';
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
    modalMode = 'config';
    renderOrderModal();
  });
}

function renderConfigView() {
  const orderModalBody = document.getElementById('orderModalBody');
  const p = configProduct;
  if (!orderModalBody || !p) return;

  orderModalBody.innerHTML = renderProductConfigView(p, configSelection, draftStock, Boolean(editingCartKey), {
    closeId: 'orderClose',
    backId: 'backBtn',
    confirmId: 'addToOrderBtn',
  });
  wireConfigEvents();
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

async function saveCheckoutDelivery({ clientId, orderClientName, snapshot }) {
  const delRes = await sbFetch('deliveries', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      client_id: clientId,
      client_name: orderClientName || null,
      origin_lat: snapshot.origin.lat,
      origin_lng: snapshot.origin.lng,
      origin_label: snapshot.pickupText || null,
      dest_lat: snapshot.dest.lat,
      dest_lng: snapshot.dest.lng,
      dest_label: snapshot.destText || null,
      distance_km: Number(snapshot.distanceKm.toFixed(3)),
      duration_min: snapshot.durationMin != null ? Number(snapshot.durationMin.toFixed(1)) : null,
      fee_ugx: snapshot.fee,
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

async function finishCheckoutBackground({ clientId, orderClientName, deliverySnapshot }) {
  try {
    const { updateTodayStrip } = await import('./home.js');
    updateTodayStrip();
  } catch (e) {
    console.error('updateTodayStrip failed', e);
  }

  if (!deliverySnapshot) return;

  try {
    await saveCheckoutDelivery({ clientId, orderClientName, snapshot: deliverySnapshot });
    markCheckoutDeliverySaved();
  } catch (e) {
    console.error('save delivery failed', e);
    markCheckoutDeliveryFailed();
    showToast('Order saved — delivery not logged', true);
  }
}

async function checkout() {
  if (checkoutInFlight) return;

  const cart = getCart();
  const orderClientName = getOrderClientName();
  const orderIsCredit = getOrderIsCredit();

  if (cart.length === 0) return;
  if (orderIsCredit && !orderClientName) {
    showToast('Select a client to record credit', true);
    return;
  }

  const checkoutBtn = document.getElementById('checkoutBtn');
  if (checkoutBtn) {
    checkoutBtn.disabled = true;
    checkoutBtn.textContent = 'Recording…';
  }
  checkoutInFlight = true;

  const mergedBreakdown = {};
  cart.forEach((item) => {
    Object.entries(item.breakdown).forEach(([id, qty]) => {
      mergedBreakdown[id] = (mergedBreakdown[id] || 0) + qty;
    });
  });
  const inventoryIds = Object.keys(mergedBreakdown);
  const inventorySnapshot = snapshotInventory(inventoryIds);
  let remoteInventoryPatched = false;

  try {
    for (const [id, qty] of Object.entries(mergedBreakdown)) {
      inventory[id] = Math.max(0, inventory[id] - qty);
      const el = document.getElementById(`inv-count-${id}`);
      if (el) el.textContent = inventory[id];
    }
    resetDraftStock();

    const [, clientId] = await Promise.all([
      patchInventoryRemote(inventoryIds),
      resolveCheckoutClientId(orderClientName),
    ]);
    remoteInventoryPatched = true;
    void dataStore.persistCurrent('inventory');

    const total = cartTotal(cart);
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
      }),
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    const saleRows = await res.json();
    if (saleRows?.[0]) void dataStore.appendSale(saleRows[0]);

    const feeVal = parseInt(checkoutFeeValue, 10);
    const deliveryAttempted =
      checkoutOrigin && checkoutDest && checkoutDistanceKm != null && feeVal > 0;
    const deliverySnapshot = deliveryAttempted
      ? {
          origin: { ...checkoutOrigin },
          dest: { ...checkoutDest },
          pickupText: checkoutPickupText,
          destText: checkoutDestText,
          distanceKm: checkoutDistanceKm,
          durationMin: checkoutDurationMin,
          fee: feeVal,
        }
      : null;

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
    renderOrderModal();

    void finishCheckoutBackground({
      clientId,
      orderClientName,
      deliverySnapshot,
    });
  } catch (e) {
    console.error('checkout failed', e);
    applyInventorySnapshot(inventorySnapshot);
    resetDraftStock();
    renderStockGlance();
    if (remoteInventoryPatched) {
      try {
        await patchInventoryRemote(inventoryIds);
        void dataStore.persistCurrent('inventory');
      } catch (revertErr) {
        console.error('inventory revert failed', revertErr);
      }
    }
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
