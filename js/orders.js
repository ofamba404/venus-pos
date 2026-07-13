import { dataStore } from './store/index.js';
import { sbFetch } from './api.js';
import {
  CAT_MAP,
  CATEGORIES,
  FLAVOR_POOL,
  PRODUCTS,
  SPLIFF_POOL,
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
  animateCartSheetContent,
  animateCheckoutSuccess,
  closeSheetModal,
  isSheetModalOpen,
  openSheetModal,
  pressButton,
  pulseFabBadge,
  registerSheetModal,
  wireGsapAccordions,
} from './animations.js';
import {
  cartTotal,
  draftStock,
  getCart,
  getOrderMeta,
  inventory,
  resetDraftStock,
  setCart,
  setOrderMeta,
} from './state.js';
import { clients } from './state.js';
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
let cartAccordions = null;
let lastCheckoutReceipt = null;
let lastOrderModalMode = null;

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

function productDetailLabel(p) {
  if (p.rule === 'single_qty') return p.unitLabel;
  if (p.rule === 'spliff_qty') return 'per joint';
  return `${p.joints} joint${p.joints > 1 ? 's' : ''}`;
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
  if (orderModal) closeSheetModal(orderModal);
}

function renderOrderModal() {
  const prevMode = lastOrderModalMode;
  lastOrderModalMode = modalMode;
  const isCartRefresh = modalMode === 'cart' && prevMode === 'cart';

  const orderModalBody = document.getElementById('orderModalBody');
  if (orderModalBody) {
    orderModalBody.className = 'modal-sheet-body';
    if (modalMode === 'cart') orderModalBody.classList.add('cart-sheet-layout');
    if (modalMode === 'success') orderModalBody.classList.add('success-sheet-layout');
  }

  if (modalMode === 'cart') renderCartView();
  else if (modalMode === 'pick') renderPickView();
  else if (modalMode === 'config') renderConfigView();
  else if (modalMode === 'success') renderSuccessView();

  const orderModal = document.getElementById('orderModal');
  if (orderModalBody && modalMode !== 'success' && !isCartRefresh && isSheetModalOpen(orderModal)) {
    animateCartSheetContent(orderModalBody);
  }
}

function dismissSuccessView() {
  lastCheckoutReceipt = null;
  modalMode = 'cart';
  const orderModal = document.getElementById('orderModal');
  if (orderModal) closeSheetModal(orderModal);
}

function renderSuccessView() {
  const orderModalBody = document.getElementById('orderModalBody');
  if (!orderModalBody || !lastCheckoutReceipt) return;

  const { items, total, clientName, isCredit, delivery, deliveryFailed } = lastCheckoutReceipt;
  const itemLabel = items.length === 1 ? '1 item' : `${items.length} items`;

  orderModalBody.innerHTML = `
    <div class="checkout-success">
      <div class="checkout-success-hero">
        <div class="checkout-success-icon" id="checkoutSuccessIcon" aria-hidden="true">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
        </div>
        <div class="modal-title checkout-success-title" id="orderModalTitle">${isCredit ? 'Recorded on credit' : 'Order recorded'}</div>
        <div class="checkout-success-total">${fmtUGX(total)}</div>
        <div class="checkout-success-sub">${itemLabel}</div>
      </div>
      ${clientName || isCredit || delivery || deliveryFailed ? `
      <div class="checkout-success-badges">
        ${clientName ? `<span class="checkout-badge checkout-badge--client">${escapeHtml(clientName)}</span>` : ''}
        ${isCredit ? `<span class="checkout-badge checkout-badge--credit">Credit — unpaid</span>` : ''}
        ${delivery ? `<span class="checkout-badge checkout-badge--delivery">Delivery logged</span>` : ''}
        ${deliveryFailed ? `<span class="checkout-badge checkout-badge--warn">Delivery not saved</span>` : ''}
      </div>` : ''}
      <div class="checkout-success-receipt">
        <div class="checkout-receipt-items">
          ${items
            .map(
              (item) => `
            <div class="checkout-receipt-item">
              <div class="checkout-receipt-item-main">
                <div class="ci-name">${escapeHtml(item.name)}</div>
                <div class="ci-detail">${escapeHtml(item.detail)}</div>
              </div>
              <div class="checkout-receipt-item-price">${fmtUGX(item.lineTotal)}</div>
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
      </div>
    </div>`;

  document.getElementById('checkoutSuccessDoneBtn')?.addEventListener('click', dismissSuccessView);
  document.getElementById('checkoutSuccessNewBtn')?.addEventListener('click', () => {
    lastCheckoutReceipt = null;
    modalMode = 'pick';
    renderOrderModal();
  });

  animateCheckoutSuccess(orderModalBody);
}

export function openOrderModal(productId) {
  configProduct = PRODUCTS.find((p) => p.id === productId);
  configSelection = {};
  modalMode = 'config';
  renderOrderModal();
  const orderModal = document.getElementById('orderModal');
  if (orderModal) openSheetModal(orderModal);
}

function updateCheckoutDistanceReadout() {
  const fields = document.querySelector('#orderModalBody .delivery-mini-fields');
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
    onPickupFocus: () => cartAccordions?.open('delivery'),
    onDestFocus: () => cartAccordions?.open('delivery'),
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
  const creditCheckbox = document.getElementById('creditCheckbox');
  if (creditCheckbox) creditCheckbox.checked = orderIsCredit;
  const creditChip = document.querySelector('.credit-chip');
  if (creditChip) creditChip.classList.toggle('is-on', orderIsCredit);
  const creditWarning = document.getElementById('cartCreditWarning');
  if (creditWarning) creditWarning.hidden = !(orderIsCredit && !orderClientName);

  const totalVal = document.querySelector('#orderModalBody .cart-total-row .ct-val');
  if (totalVal) totalVal.textContent = fmtUGX(cartTotal(cart));
}

function cartItemHtml(item) {
  return `
    <div class="cart-item">
      <div class="cart-item-main">
        <div class="ci-name">${escapeHtml(item.name)}</div>
        <div class="ci-detail">${escapeHtml(item.detail)}</div>
      </div>
      <div class="cart-item-actions">
        <div class="ci-price">${fmtUGX(item.lineTotal)}</div>
        <div class="cart-item-btns">
          <button class="cart-edit" data-edit="${item.key}" type="button" title="Edit item" aria-label="Edit ${escapeHtml(item.name)}">✎</button>
          <button class="cart-remove" data-remove="${item.key}" type="button" aria-label="Remove ${escapeHtml(item.name)}">✕</button>
        </div>
      </div>
    </div>`;
}

function cartEmptyHtml() {
  return `
    <div class="cart-empty">
      <div class="cart-empty-title">No items yet</div>
      <div class="cart-empty-hint">Tap "Add item" to start building the order</div>
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
  const itemLabel = cart.length === 1 ? '1 item' : `${cart.length} items`;
  const subtitle = orderModalBody.querySelector('.modal-subtitle');
  if (subtitle) subtitle.textContent = cart.length ? itemLabel : 'No items yet';

  const itemsAnchor = orderModalBody.querySelector('.cart-items-section');
  if (!itemsAnchor) {
    renderOrderModal();
    return;
  }

  itemsAnchor.innerHTML = cart.length
    ? `<div class="cart-items-list">${cart.map(cartItemHtml).join('')}</div>`
    : cartEmptyHtml();

  const actionsSection = orderModalBody.querySelector('.cart-sheet-actions');
  const totalRow = actionsSection?.querySelector('.cart-total-row');
  if (cart.length) {
    if (!totalRow && actionsSection) {
      actionsSection.insertAdjacentHTML(
        'afterbegin',
        `<div class="cart-total-row"><div class="ct-label">Total</div><div class="ct-val">${fmtUGX(cartTotal(cart))}</div></div>`,
      );
    }
  } else {
    totalRow?.remove();
  }

  wireCartItemButtons(itemsAnchor);
  updateCartCheckoutState();
}

function renderCartView() {
  const orderModalBody = document.getElementById('orderModalBody');
  if (!orderModalBody) return;

  const cart = getCart();
  const orderClientName = getOrderClientName();
  const orderIsCredit = getOrderIsCredit();
  const itemLabel = cart.length === 1 ? '1 item' : `${cart.length} items`;
  const creditBlocked = orderIsCredit && !orderClientName;

  const itemsSection = cart.length
    ? `<div class="cart-items-list">${cart.map(cartItemHtml).join('')}</div>`
    : cartEmptyHtml();

  const scrollInner = `
    <div class="modal-header modal-header--cart">
      <div class="modal-header-copy">
        <div class="modal-title" id="orderModalTitle">Current order</div>
        <div class="modal-subtitle">${cart.length ? itemLabel : 'No items yet'}</div>
      </div>
      <button class="modal-close" id="orderClose" type="button" data-order-close aria-label="Close order">✕</button>
    </div>
    <div class="cart-items-section">${itemsSection}</div>
    <div class="client-picker">
      <div class="client-picker__head">
        <label for="cartClientInput">Client</label>
        <label class="credit-chip${orderIsCredit ? ' is-on' : ''}" title="Record as unpaid credit sale">
          <input type="checkbox" id="creditCheckbox" class="credit-chip__input" ${orderIsCredit ? 'checked' : ''} />
          <span class="credit-chip__label">Credit</span>
        </label>
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
    <div class="sheet-accordion delivery-mini" data-accordion data-accordion-id="delivery" data-accordion-open="${checkoutPickupText || checkoutDestText || checkoutFeeValue ? 'true' : 'false'}">
      <button type="button" class="sheet-accordion__trigger" data-accordion-trigger aria-expanded="${checkoutPickupText || checkoutDestText || checkoutFeeValue ? 'true' : 'false'}">
        <span class="sheet-accordion__label">Delivery <span class="sheet-accordion-hint">optional</span></span>
        <span class="sheet-accordion__caret" aria-hidden="true"></span>
      </button>
      <div class="sheet-accordion__panel" data-accordion-panel>
        <div class="delivery-mini-fields">
          <div class="delivery-input-wrap pickup">
            <span class="di-icon">${ICON_LOCATE}</span>
            ${deliveryPlaceFieldMarkup({
              inputId: 'deliveryPickupInput',
              dropdownId: 'deliveryPickupDropdown',
              placeholder: 'Pickup location',
              value: checkoutPickupText,
            })}
          </div>
          <div class="delivery-input-wrap dropoff">
            <span class="di-icon">${ICON_PIN}</span>
            ${deliveryPlaceFieldMarkup({
              inputId: 'deliveryDestInput',
              dropdownId: 'deliveryDestDropdown',
              placeholder: 'Drop-off location',
              value: checkoutDestText,
            })}
          </div>
          <div class="delivery-input-wrap fee">
            <span class="di-icon">${ICON_CASH}</span>
            <input type="text" inputmode="numeric" pattern="[0-9]*" class="client-input" id="deliveryFeeInputCart" placeholder="SafeBoda fee charged (UGX)" autocomplete="off" value="${escapeHtml(checkoutFeeValue)}" />
          </div>
          ${checkoutDistanceKm != null ? `<div class="delivery-mini-readout">${ICON_ROUTE} ${checkoutDistanceKm.toFixed(1)} km · ~${Math.round(checkoutDurationMin)} min</div>` : ''}
        </div>
      </div>
    </div>
    <div class="cart-sheet-actions">
      ${cart.length ? `<div class="cart-total-row"><div class="ct-label">Total</div><div class="ct-val">${fmtUGX(cartTotal(cart))}</div></div>` : ''}
      <button class="add-item-btn" id="addItemBtn" type="button">+ Add item</button>
      <div class="modal-btns">
        <button class="modal-btn cancel" id="cancelOrderBtn" type="button">Cancel order</button>
        <button class="modal-btn confirm" id="checkoutBtn" ${cart.length && !creditBlocked ? '' : 'disabled'} type="button">${orderIsCredit ? 'Record on credit' : 'Checkout'}</button>
      </div>
    </div>`;

  orderModalBody.innerHTML = `<div class="cart-sheet-scroll">${scrollInner}</div>`;
  orderModalBody.classList.add('cart-sheet-layout');

  cartAccordions = wireGsapAccordions(orderModalBody);

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
    },
  });
  document.getElementById('creditCheckbox')?.addEventListener('change', (e) => {
    setOrderIsCredit(e.target.checked);
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
  const cart = getCart();

  let inner = `
    <div class="modal-header">
      <div class="modal-title">Add item</div>
      <button class="modal-close" id="orderClose" type="button" data-order-close>✕</button>
    </div>`;
  inner += PRODUCTS.map(
    (p) => `
    <div class="pick-product-row" data-product="${p.id}">
      <div>
        <div class="ppr-name">${escapeHtml(p.name)}</div>
        <div class="pick-stock">${productDetailLabel(p)}</div>
      </div>
      <div class="ppr-price">${fmtUGX(p.price || p.unitPrice)}</div>
    </div>`,
  ).join('');
  inner += `<div class="modal-btns"><button class="modal-btn cancel" id="backToCart" type="button">‹ Back to order</button></div>`;

  orderModalBody.innerHTML = inner;
  document.getElementById('backToCart')?.addEventListener('click', () => {
    modalMode = 'cart';
    renderOrderModal();
  });
  orderModalBody.querySelectorAll('[data-product]').forEach((row) => {
    row.addEventListener('click', () => {
      configProduct = PRODUCTS.find((p) => p.id === row.dataset.product);
      configSelection = {};
      modalMode = 'config';
      renderOrderModal();
    });
  });
}

function configTotalSelected() {
  return Object.values(configSelection).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
}

function renderConfigView() {
  const orderModalBody = document.getElementById('orderModalBody');
  const p = configProduct;
  if (!orderModalBody || !p) return;

  let inner = `
    <div class="modal-header">
      <div class="modal-title">${editingCartKey ? `Edit — ${escapeHtml(p.name)}` : escapeHtml(p.name)}</div>
      <button class="modal-close" id="orderClose" type="button" data-order-close>✕</button>
    </div>`;

  if (p.rule === 'choose_any') {
    inner += `<div class="modal-price">${fmtUGX(p.price)}</div>`;
    inner += `<div class="modal-progress">Selected ${configTotalSelected()} / ${p.joints}</div>`;
    FLAVOR_POOL.forEach((id) => {
      const cat = CAT_MAP[id];
      const chosen = configSelection[id] || 0;
      const remaining = p.joints - configTotalSelected();
      const canAdd = remaining > 0 && chosen < draftStock[id];
      const canRemove = chosen > 0;
      inner += `
        <div class="pick-row">
          <div class="pick-info">
            <span class="dot" style="background:${cat.color}"></span>
            <span class="pick-name">${cat.name}</span>
            <span class="pick-stock">(${draftStock[id]} in stock)</span>
          </div>
          <div class="pick-controls">
            <button class="mini-step" data-pick="${id}" data-pdir="-1" ${canRemove ? '' : 'disabled'} type="button">–</button>
            <span class="mini-count">${chosen}</span>
            <button class="mini-step" data-pick="${id}" data-pdir="1" ${canAdd ? '' : 'disabled'} type="button">+</button>
          </div>
        </div>`;
    });
    const ready = configTotalSelected() === p.joints;
    inner += `<div class="modal-btns">
      <button class="modal-btn cancel" id="backBtn" type="button">‹ Back</button>
      <button class="modal-btn confirm" id="addToOrderBtn" ${ready ? '' : 'disabled'} type="button">${editingCartKey ? 'Save changes' : 'Add to order'}</button>
    </div>`;
  } else if (p.rule === 'choose_variety') {
    inner += `<div class="modal-price">${fmtUGX(p.price)}</div>`;
    const flavorTarget = p.joints - 1;
    const flavorSelected = configTotalSelected();
    inner += `<div class="modal-progress">Selected ${flavorSelected} / ${flavorTarget} flavors</div>`;
    FLAVOR_POOL.forEach((id) => {
      const cat = CAT_MAP[id];
      const chosen = configSelection[id] || 0;
      const remaining = flavorTarget - flavorSelected;
      const canAdd = remaining > 0 && chosen < draftStock[id];
      const canRemove = chosen > 0;
      inner += `
        <div class="pick-row">
          <div class="pick-info">
            <span class="dot" style="background:${cat.color}"></span>
            <span class="pick-name">${cat.name}</span>
            <span class="pick-stock">(${draftStock[id]} in stock)</span>
          </div>
          <div class="pick-controls">
            <button class="mini-step" data-pick="${id}" data-pdir="-1" ${canRemove ? '' : 'disabled'} type="button">–</button>
            <span class="mini-count">${chosen}</span>
            <button class="mini-step" data-pick="${id}" data-pdir="1" ${canAdd ? '' : 'disabled'} type="button">+</button>
          </div>
        </div>`;
    });
    const plainOk = draftStock.classic >= 1;
    inner += `<div class="fixed-item"><span>Plain <span class="pick-stock">(fixed)</span></span><span class="${plainOk ? 'ok' : 'no'}">${plainOk ? '1 included' : 'out of stock'}</span></div>`;
    const ready = flavorSelected === flavorTarget && plainOk;
    inner += `<div class="modal-btns">
      <button class="modal-btn cancel" id="backBtn" type="button">‹ Back</button>
      <button class="modal-btn confirm" id="addToOrderBtn" ${ready ? '' : 'disabled'} type="button">${editingCartKey ? 'Save changes' : 'Add to order'}</button>
    </div>`;
  } else if (p.rule === 'single_qty') {
    const qty = configSelection.qty || 0;
    const catId = p.categoryId;
    inner += `<div class="modal-progress">In stock: ${draftStock[catId]}</div>`;
    inner += `<input type="text" inputmode="numeric" pattern="[0-9]*" id="qtyField" class="qty-input" placeholder="0" value="${qty || ''}" autocomplete="off" />`;
    inner += `<div class="modal-price" id="qtyLinePrice" style="margin-top:10px;">${fmtUGX((qty || 0) * p.unitPrice)}</div>`;
    const ready = qty > 0 && qty <= draftStock[catId];
    inner += `<div class="modal-btns">
      <button class="modal-btn cancel" id="backBtn" type="button">‹ Back</button>
      <button class="modal-btn confirm" id="addToOrderBtn" ${ready ? '' : 'disabled'} type="button">${editingCartKey ? 'Save changes' : 'Add to order'}</button>
    </div>`;
  } else if (p.rule === 'spliff_qty') {
    inner += `<div class="modal-progress">Enter quantity for each</div>`;
    SPLIFF_POOL.forEach((id) => {
      const cat = CAT_MAP[id];
      const qty = configSelection[id] || 0;
      inner += `
        <div class="pick-row">
          <div class="pick-info">
            <span class="dot" style="background:${cat.color}"></span>
            <span class="pick-name">Bangis ${cat.sub}</span>
            <span class="pick-stock">(${draftStock[id]} in stock)</span>
          </div>
          <input type="text" inputmode="numeric" pattern="[0-9]*" class="qty-mini-input" data-spliff-qty="${id}" value="${qty || ''}" placeholder="0" />
        </div>`;
    });
    const totalQty = SPLIFF_POOL.reduce((s, id) => s + (configSelection[id] || 0), 0);
    inner += `<div class="modal-price" id="qtyLinePrice" style="margin-top:10px;">${fmtUGX(totalQty * p.unitPrice)}</div>`;
    const overStock = SPLIFF_POOL.some((id) => (configSelection[id] || 0) > draftStock[id]);
    const ready = totalQty > 0 && !overStock;
    inner += `<div class="modal-btns">
      <button class="modal-btn cancel" id="backBtn" type="button">‹ Back</button>
      <button class="modal-btn confirm" id="addToOrderBtn" ${ready ? '' : 'disabled'} type="button">${editingCartKey ? 'Save changes' : 'Add to order'}</button>
    </div>`;
  }

  orderModalBody.innerHTML = inner;
  wireConfigEvents();
}

function wireConfigEvents() {
  const cart = getCart();
  document.getElementById('backBtn')?.addEventListener('click', () => {
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
  });

  document.querySelectorAll('button.mini-step').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.pick;
      const dir = parseInt(btn.dataset.pdir, 10);
      configSelection[id] = Math.max(0, (configSelection[id] || 0) + dir);
      if (configSelection[id] === 0) delete configSelection[id];
      renderConfigView();
    });
  });

  const qtyField = document.getElementById('qtyField');
  if (qtyField) {
    qtyField.focus();
    qtyField.addEventListener('input', () => {
      qtyField.value = qtyField.value.replace(/[^0-9]/g, '');
      configSelection.qty = parseInt(qtyField.value, 10) || 0;
      renderConfigView();
      const el = document.getElementById('qtyField');
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }

  document.querySelectorAll('[data-spliff-qty]').forEach((inputEl) => {
    inputEl.addEventListener('input', () => {
      inputEl.value = inputEl.value.replace(/[^0-9]/g, '');
      const id = inputEl.dataset.spliffQty;
      configSelection[id] = parseInt(inputEl.value, 10) || 0;
      renderConfigView();
      const el = document.querySelector(`[data-spliff-qty="${id}"]`);
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  });

  document.getElementById('addToOrderBtn')?.addEventListener('click', addConfiguredItemToCart);
}

function addConfiguredItemToCart() {
  const p = configProduct;
  if (!p) return;

  if (editingCartKey) {
    editingCartKey = null;
    editingCartItem = null;
  }

  let breakdown = {};
  let lineTotal = 0;
  let detail = '';

  if (p.rule === 'choose_any') {
    breakdown = { ...configSelection };
    lineTotal = p.price;
    detail = Object.entries(breakdown)
      .map(([id, qty]) => `${CAT_MAP[id].name} x${qty}`)
      .join(', ');
  } else if (p.rule === 'choose_variety') {
    breakdown = { ...configSelection, classic: 1 };
    lineTotal = p.price;
    detail =
      FLAVOR_POOL.filter((id) => configSelection[id] > 0)
        .map((id) => `${CAT_MAP[id].name} x${configSelection[id]}`)
        .join(', ') + ' + Plain';
  } else if (p.rule === 'single_qty') {
    breakdown = { [p.categoryId]: configSelection.qty };
    lineTotal = configSelection.qty * p.unitPrice;
    detail = `x${configSelection.qty}`;
  } else if (p.rule === 'spliff_qty') {
    SPLIFF_POOL.forEach((id) => {
      if (configSelection[id] > 0) breakdown[id] = configSelection[id];
    });
    const totalQty = Object.values(breakdown).reduce((a, b) => a + b, 0);
    lineTotal = totalQty * p.unitPrice;
    detail = Object.entries(breakdown)
      .map(([id, qty]) => `${CAT_MAP[id].sub} x${qty}`)
      .join(', ');
  }

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

async function checkout() {
  const cart = getCart();
  const orderClientName = getOrderClientName();
  const orderIsCredit = getOrderIsCredit();

  if (cart.length === 0) return;
  if (orderIsCredit && !orderClientName) {
    showToast('Select a client to record credit', true);
    return;
  }

  const mergedBreakdown = {};
  cart.forEach((item) => {
    Object.entries(item.breakdown).forEach(([id, qty]) => {
      mergedBreakdown[id] = (mergedBreakdown[id] || 0) + qty;
    });
  });

  try {
    for (const [id, qty] of Object.entries(mergedBreakdown)) {
      inventory[id] = Math.max(0, inventory[id] - qty);
      await sbFetch(`inventory?category_id=eq.${id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ stock: inventory[id], updated_at: new Date().toISOString() }),
      });
      const el = document.getElementById(`inv-count-${id}`);
      if (el) el.textContent = inventory[id];
    }
    resetDraftStock();
    await dataStore.persistCurrent('inventory');

    const total = cartTotal(cart);
    const items = cart.map((i) => ({
      product_id: i.productId,
      product_name: i.name,
      detail: i.detail,
      line_total: i.lineTotal,
      breakdown: i.breakdown,
    }));
    let clientId = getOrderClientId();
    if (clientId) {
      const byId = clients.find((c) => c.id === clientId);
      clientId = byId?.id ?? (await resolveClientId(orderClientName));
    } else {
      clientId = await resolveClientId(orderClientName);
    }

    const res = await sbFetch('sales', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        items,
        total_ugx: total,
        client_id: clientId,
        is_credit: orderIsCredit,
        credit_cleared: !orderIsCredit,
      }),
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);

    const feeVal = parseInt(checkoutFeeValue, 10);
    const deliveryAttempted =
      checkoutOrigin && checkoutDest && checkoutDistanceKm != null && feeVal > 0;
    let deliverySaved = false;
    let deliveryFailed = false;

    if (deliveryAttempted) {
      try {
        const delRes = await sbFetch('deliveries', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            client_id: clientId,
            client_name: orderClientName || null,
            origin_lat: checkoutOrigin.lat,
            origin_lng: checkoutOrigin.lng,
            origin_label: checkoutPickupText || null,
            dest_lat: checkoutDest.lat,
            dest_lng: checkoutDest.lng,
            dest_label: checkoutDestText || null,
            distance_km: Number(checkoutDistanceKm.toFixed(3)),
            duration_min: checkoutDurationMin != null ? Number(checkoutDurationMin.toFixed(1)) : null,
            fee_ugx: feeVal,
          }),
        });
        if (!delRes.ok) throw new Error(`Supabase ${delRes.status}`);
        const delRows = await delRes.json();
        if (delRows[0]) await dataStore.appendDelivery(delRows[0]);
        deliverySaved = true;
      } catch (e) {
        console.error('save delivery failed', e);
        deliveryFailed = true;
      }
    }

    lastCheckoutReceipt = {
      items: cart.map((item) => ({
        name: item.name,
        detail: item.detail,
        lineTotal: item.lineTotal,
      })),
      total,
      clientName: orderClientName,
      isCredit: orderIsCredit,
      delivery: deliverySaved
        ? {
            pickup: checkoutPickupText,
            dest: checkoutDestText,
            distanceKm: checkoutDistanceKm,
            durationMin: checkoutDurationMin,
            fee: feeVal,
          }
        : null,
      deliveryFailed,
    };

    setCart([]);
    setOrderMeta({ clientName: '', clientId: '', isCredit: false });
    resetCheckoutDelivery();
    updateFabBadge();
    renderStockGlance();

    const { updateTodayStrip } = await import('./home.js');
    await dataStore.invalidate('sales');
    updateTodayStrip();

    modalMode = 'success';
    renderOrderModal();
  } catch (e) {
    console.error('checkout failed', e);
    showToast('Checkout failed — check connection', true);
    updateCartCheckoutState();
  }
}

export function wireOrders() {
  const orderModal = document.getElementById('orderModal');
  registerSheetModal(orderModal, { onDismiss: closeOrderModal });

  orderModal?.addEventListener('click', (e) => {
    if (e.target === orderModal) closeOrderModal();
  });

  document.getElementById('fabNewOrder')?.addEventListener('click', () => {
    lastCheckoutReceipt = null;
    const cart = getCart();
    modalMode = cart.length ? 'cart' : 'pick';
    renderOrderModal();
    if (orderModal) openSheetModal(orderModal);
  });

  updateFabBadge();
}

export function renderProductList() {
  const productList = document.getElementById('productList');
  if (!productList) return;

  productList.innerHTML = PRODUCTS.map(
    (p) => `
    <button class="product-row" type="button" data-product="${p.id}">
      <div>
        <div class="pname">${escapeHtml(p.name)}</div>
        <div class="pcount">${productDetailLabel(p)}</div>
      </div>
      <div class="p-right">
        <div class="pprice">${fmtUGX(p.price || p.unitPrice)}</div>
      </div>
    </button>`,
  ).join('');

  productList.querySelectorAll('[data-product]').forEach((row) => {
    row.addEventListener('click', () => {
      pressButton(row);
      openOrderModal(row.dataset.product);
    });
  });
}
