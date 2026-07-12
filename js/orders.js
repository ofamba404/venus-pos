import { clearCache, writeCache } from './cache.js';
import { sbFetch } from './api.js';
import {
  CAT_MAP,
  CATEGORIES,
  FLAVOR_POOL,
  PRODUCTS,
  SPLIFF_POOL,
} from './config.js';
import { addClient, filterClients, findClientByName, highlightClientName, resolveClientId } from './clients.js';
import {
  ICON_CASH,
  ICON_LOCATE,
  ICON_PIN,
  ICON_ROUTE,
  loadGoogleMaps,
} from './delivery.js';
import { adjustStock, renderStockGlance } from './inventory.js';
import { loadSalesToday } from './sales.js';
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
let checkoutOrigin = null;
let checkoutPickupText = '';
let checkoutDest = null;
let checkoutDestText = '';
let checkoutDistanceKm = null;
let checkoutDurationMin = null;
let checkoutFeeValue = '';
let pickupAutocomplete = null;
let destAutocomplete = null;
let pickupAutoRequested = false;

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
}

function productDetailLabel(p) {
  if (p.rule === 'single_qty') return p.unitLabel;
  if (p.rule === 'spliff_qty') return 'per joint';
  return `${p.joints} joint${p.joints > 1 ? 's' : ''}`;
}

function closeOrderModal() {
  const orderModal = document.getElementById('orderModal');
  if (orderModal) orderModal.hidden = true;
}

function renderOrderModal() {
  if (modalMode === 'cart') renderCartView();
  else if (modalMode === 'pick') renderPickView();
  else if (modalMode === 'pickClient') renderPickClientView();
  else if (modalMode === 'config') renderConfigView();
}

export function openOrderModal(productId) {
  configProduct = PRODUCTS.find((p) => p.id === productId);
  configSelection = {};
  modalMode = 'config';
  renderOrderModal();
  const orderModal = document.getElementById('orderModal');
  if (orderModal) orderModal.hidden = false;
}

function clearAutocompleteWidgets() {
  document.querySelectorAll('.pac-container').forEach((el) => el.remove());
  if (pickupAutocomplete && window.google) {
    google.maps.event.clearInstanceListeners(pickupAutocomplete);
  }
  if (destAutocomplete && window.google) {
    google.maps.event.clearInstanceListeners(destAutocomplete);
  }
  pickupAutocomplete = null;
  destAutocomplete = null;
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
        if (modalMode === 'cart') renderCartView();
      },
    );
  });
}

function wireDeliveryAutocompletes(pickupInput, destInput) {
  if (!pickupInput || !destInput) return;
  loadGoogleMaps(() => {
    clearAutocompleteWidgets();
    pickupAutocomplete = new google.maps.places.Autocomplete(pickupInput, {
      fields: ['geometry', 'formatted_address', 'name'],
      componentRestrictions: { country: 'ug' },
    });
    pickupAutocomplete.addListener('place_changed', () => {
      const place = pickupAutocomplete.getPlace();
      if (!place.geometry) return;
      checkoutOrigin = { lat: place.geometry.location.lat(), lng: place.geometry.location.lng() };
      checkoutPickupText = place.formatted_address || place.name || pickupInput.value;
      pickupInput.value = checkoutPickupText;
      computeCheckoutDistance();
    });
    destAutocomplete = new google.maps.places.Autocomplete(destInput, {
      fields: ['geometry', 'formatted_address', 'name'],
      componentRestrictions: { country: 'ug' },
    });
    destAutocomplete.addListener('place_changed', () => {
      const place = destAutocomplete.getPlace();
      if (!place.geometry) return;
      checkoutDest = { lat: place.geometry.location.lat(), lng: place.geometry.location.lng() };
      checkoutDestText = place.formatted_address || place.name || destInput.value;
      destInput.value = checkoutDestText;
      computeCheckoutDistance();
    });
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
          computeCheckoutDistance();
          if (modalMode === 'cart') renderCartView();
        });
      });
    },
    () => {},
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

function renderCartView() {
  const orderModalBody = document.getElementById('orderModalBody');
  if (!orderModalBody) return;

  const cart = getCart();
  const orderClientName = getOrderClientName();
  const orderIsCredit = getOrderIsCredit();

  let inner = `
    <div class="modal-header">
      <div class="modal-title">Current order</div>
      <button class="modal-close" id="orderClose" type="button">✕</button>
    </div>
    <div class="client-picker">
      <label>Client</label>
      ${
        orderClientName
          ? `<div class="client-chip">
              <button class="client-chip-main" id="pickClientBtn" type="button" title="Change client">
                <span>${escapeHtml(orderClientName)}</span>
                <span class="client-chip-hint">Change</span>
              </button>
              <button class="cl-icon-btn" id="clearClientBtn" title="Remove client" type="button">✕</button>
            </div>`
          : `<button class="add-item-btn" id="pickClientBtn" style="margin-top:0;" type="button">+ Select or add client</button>`
      }
    </div>
    <label class="credit-toggle-row">
      <input type="checkbox" id="creditCheckbox" ${orderIsCredit ? 'checked' : ''} />
      <span>Record as credit (unpaid — front to client)</span>
    </label>`;

  if (orderIsCredit && !orderClientName) {
    inner += `<div class="credit-warning">Select a client above before recording credit</div>`;
  }

  inner += `
    <div class="delivery-mini">
      <div class="delivery-mini-label">Delivery (optional)</div>
      <div class="delivery-input-wrap pickup">
        <span class="di-icon">${ICON_LOCATE}</span>
        <input type="text" class="client-input" id="deliveryPickupInput" placeholder="Pickup location" autocomplete="off" value="${escapeHtml(checkoutPickupText)}" />
      </div>
      <div class="delivery-input-wrap dropoff">
        <span class="di-icon">${ICON_PIN}</span>
        <input type="text" class="client-input" id="deliveryDestInput" placeholder="Drop-off location" autocomplete="off" value="${escapeHtml(checkoutDestText)}" />
      </div>
      <div class="delivery-input-wrap fee">
        <span class="di-icon">${ICON_CASH}</span>
        <input type="text" inputmode="numeric" pattern="[0-9]*" class="client-input" id="deliveryFeeInputCart" placeholder="SafeBoda fee charged (UGX)" autocomplete="off" value="${escapeHtml(checkoutFeeValue)}" />
      </div>
      ${checkoutDistanceKm != null ? `<div class="delivery-mini-readout">${ICON_ROUTE} ${checkoutDistanceKm.toFixed(1)} km · ~${Math.round(checkoutDurationMin)} min</div>` : ''}
    </div>`;

  if (cart.length === 0) {
    inner += `<div class="cart-empty">No items yet — tap "Add item" below</div>`;
  } else {
    inner += cart
      .map(
        (item) => `
      <div class="cart-item">
        <div>
          <div class="ci-name">${escapeHtml(item.name)}</div>
          <div class="ci-detail">${escapeHtml(item.detail)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="ci-price">${fmtUGX(item.lineTotal)}</div>
          <button class="cart-remove" data-remove="${item.key}" type="button">✕</button>
        </div>
      </div>`,
      )
      .join('');
    inner += `
      <div class="cart-total-row">
        <div class="ct-label">Total</div>
        <div class="ct-val">${fmtUGX(cartTotal(cart))}</div>
      </div>`;
  }

  const creditBlocked = orderIsCredit && !orderClientName;
  inner += `
    <button class="add-item-btn" id="addItemBtn" type="button">+ Add item</button>
    <div class="modal-btns">
      <button class="modal-btn cancel" id="cancelOrderBtn" type="button">Cancel order</button>
      <button class="modal-btn confirm" id="checkoutBtn" ${cart.length && !creditBlocked ? '' : 'disabled'} type="button">${orderIsCredit ? 'Record on credit' : 'Checkout'}</button>
    </div>`;

  orderModalBody.innerHTML = inner;
  document.getElementById('orderClose')?.addEventListener('click', closeOrderModal);
  document.getElementById('pickClientBtn')?.addEventListener('click', () => {
    modalMode = 'pickClient';
    renderOrderModal();
  });
  document.getElementById('clearClientBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    setOrderClient(null);
    setOrderIsCredit(false);
    renderCartView();
  });
  document.getElementById('creditCheckbox')?.addEventListener('change', (e) => {
    setOrderIsCredit(e.target.checked);
    renderCartView();
  });
  document.getElementById('addItemBtn')?.addEventListener('click', () => {
    modalMode = 'pick';
    renderOrderModal();
  });

  const pickupInput = document.getElementById('deliveryPickupInput');
  const destInput = document.getElementById('deliveryDestInput');
  wireDeliveryAutocompletes(pickupInput, destInput);
  pickupInput?.addEventListener('input', () => {
    checkoutPickupText = pickupInput.value;
    if (!pickupInput.value) {
      checkoutOrigin = null;
      checkoutDistanceKm = null;
    }
  });
  destInput?.addEventListener('input', () => {
    checkoutDestText = destInput.value;
    if (!destInput.value) {
      checkoutDest = null;
      checkoutDistanceKm = null;
    }
  });
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
  orderModalBody.querySelectorAll('[data-remove]').forEach((btn) => {
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
      renderCartView();
    });
  });
}

function renderPickView() {
  const orderModalBody = document.getElementById('orderModalBody');
  if (!orderModalBody) return;
  const cart = getCart();

  let inner = `
    <div class="modal-header">
      <div class="modal-title">Add item</div>
      <button class="modal-close" id="orderClose" type="button">✕</button>
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
  document.getElementById('orderClose')?.addEventListener('click', closeOrderModal);
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

function selectOrderClient(client) {
  if (!client) return;
  setOrderClient(client);
  modalMode = 'cart';
  renderOrderModal();
}

function updateClientPickList(query) {
  const list = document.getElementById('clientPickList');
  const meta = document.getElementById('clientPickMeta');
  if (!list) return;

  const trimmed = query?.trim() || '';
  const filtered = filterClients(trimmed);
  const exact = trimmed ? findClientByName(trimmed) : null;
  const showCreate = trimmed.length > 0 && !exact;

  if (meta) {
    if (!clients.length && !trimmed) meta.textContent = '';
    else if (!trimmed) meta.textContent = `${clients.length} saved client${clients.length === 1 ? '' : 's'}`;
    else if (filtered.length === 0 && !showCreate) meta.textContent = 'No matches';
    else meta.textContent = showCreate ? 'Tap a match or create new' : `${filtered.length} match${filtered.length === 1 ? '' : 'es'}`;
  }

  let html = '';
  if (showCreate) {
    html += `
      <button class="client-pick-create" data-create-client type="button">
        <span class="client-pick-create-label">Create</span>
        <span class="client-pick-create-name">“${escapeHtml(trimmed)}”</span>
      </button>`;
  }

  if (filtered.length === 0 && !showCreate) {
    html += `<div class="client-empty client-empty-compact">${clients.length ? `No clients match “${escapeHtml(trimmed)}”` : 'No saved clients yet — type a name above'}</div>`;
  } else {
    html += filtered
      .map(
        (c) => `
      <button class="pick-product-row client-pick-row" data-client="${c.id}" type="button">
        <div class="ppr-name">${highlightClientName(c.name, trimmed)}</div>
      </button>`,
      )
      .join('');
  }

  list.innerHTML = html;

  list.querySelector('[data-create-client]')?.addEventListener('click', async () => {
    const created = await addClient(trimmed);
    if (created) selectOrderClient(created);
    else showToast('Could not add client — name may already exist', true);
  });

  list.querySelectorAll('[data-client]').forEach((row) => {
    row.addEventListener('click', () => {
      const client = clients.find((c) => c.id === row.dataset.client);
      selectOrderClient(client);
    });
  });
}

function renderPickClientView() {
  const orderModalBody = document.getElementById('orderModalBody');
  if (!orderModalBody) return;

  const inner = `
    <div class="modal-header">
      <div class="modal-title">Select client</div>
      <button class="modal-close" id="orderClose" type="button">✕</button>
    </div>
    <div class="client-search-wrap client-search-wrap-modal">
      <input type="search" id="clientPickSearch" class="client-input" placeholder="Search or type a new name…" autocomplete="off" enterkeyhint="search" />
      <button class="client-search-clear" id="clientPickSearchClear" type="button" hidden aria-label="Clear search">✕</button>
    </div>
    <div class="client-list-meta" id="clientPickMeta"></div>
    <div class="client-pick-list" id="clientPickList"></div>
    <div class="modal-btns"><button class="modal-btn cancel" id="backToCart" type="button">‹ Back to order</button></div>`;

  orderModalBody.innerHTML = inner;
  document.getElementById('orderClose')?.addEventListener('click', closeOrderModal);
  document.getElementById('backToCart')?.addEventListener('click', () => {
    modalMode = 'cart';
    renderOrderModal();
  });

  const searchInput = document.getElementById('clientPickSearch');
  const searchClear = document.getElementById('clientPickSearchClear');
  updateClientPickList('');

  searchInput?.focus();
  searchInput?.addEventListener('input', () => {
    const q = searchInput.value;
    if (searchClear) {
      if (q) searchClear.removeAttribute('hidden');
      else searchClear.setAttribute('hidden', '');
    }
    updateClientPickList(q);
  });
  searchClear?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    searchClear.setAttribute('hidden', '');
    searchInput?.focus();
    updateClientPickList('');
  });

  searchInput?.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const trimmed = searchInput.value.trim();
    if (!trimmed) return;

    const exact = findClientByName(trimmed);
    if (exact) {
      selectOrderClient(exact);
      return;
    }

    const filtered = filterClients(trimmed);
    if (filtered.length === 1) {
      selectOrderClient(filtered[0]);
      return;
    }

    const created = await addClient(trimmed);
    if (created) selectOrderClient(created);
    else showToast('Could not add client — name may already exist', true);
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
      <div class="modal-title">${escapeHtml(p.name)}</div>
      <button class="modal-close" id="orderClose" type="button">✕</button>
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
      <button class="modal-btn confirm" id="addToOrderBtn" ${ready ? '' : 'disabled'} type="button">Add to order</button>
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
      <button class="modal-btn confirm" id="addToOrderBtn" ${ready ? '' : 'disabled'} type="button">Add to order</button>
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
      <button class="modal-btn confirm" id="addToOrderBtn" ${ready ? '' : 'disabled'} type="button">Add to order</button>
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
      <button class="modal-btn confirm" id="addToOrderBtn" ${ready ? '' : 'disabled'} type="button">Add to order</button>
    </div>`;
  }

  orderModalBody.innerHTML = inner;
  wireConfigEvents();
}

function wireConfigEvents() {
  const cart = getCart();
  document.getElementById('orderClose')?.addEventListener('click', closeOrderModal);
  document.getElementById('backBtn')?.addEventListener('click', () => {
    modalMode = cart.length ? 'cart' : 'pick';
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
    writeCache(
      'inventory',
      CATEGORIES.map((c) => ({ category_id: c.id, stock: inventory[c.id] })),
    );

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
    if (checkoutOrigin && checkoutDest && checkoutDistanceKm != null && feeVal > 0) {
      try {
        await sbFetch('deliveries', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
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
      } catch (e) {
        console.error('save delivery failed', e);
        showToast('Order recorded, but delivery details did not save', true);
      }
    }

    showToast(orderIsCredit ? `Recorded on credit — ${fmtUGX(total)}` : `Order recorded — ${fmtUGX(total)}`);
    setCart([]);
    setOrderMeta({ clientName: '', clientId: '', isCredit: false });
    resetCheckoutDelivery();
    updateFabBadge();
    closeOrderModal();
    renderStockGlance();

    clearCache('sales');
    const { updateTodayStrip } = await import('./home.js');
    await loadSalesToday();
    updateTodayStrip();
  } catch (e) {
    console.error('checkout failed', e);
    showToast('Checkout failed — check connection', true);
  }
}

export function wireOrders() {
  const orderModal = document.getElementById('orderModal');
  orderModal?.addEventListener('click', (e) => {
    if (e.target === orderModal) closeOrderModal();
  });

  document.getElementById('fabNewOrder')?.addEventListener('click', () => {
    const cart = getCart();
    modalMode = cart.length ? 'cart' : 'pick';
    renderOrderModal();
    if (orderModal) orderModal.hidden = false;
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
        <span class="p-arrow" aria-hidden="true">›</span>
      </div>
    </button>`,
  ).join('');

  productList.querySelectorAll('[data-product]').forEach((row) => {
    row.addEventListener('click', () => openOrderModal(row.dataset.product));
  });
}
