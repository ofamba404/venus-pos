import {
  CAT_MAP,
  FLAVOR_POOL,
  PRODUCTS,
  SPLIFF_POOL,
} from './config.js';
import { escapeHtml, fmtUGX } from './utils.js';

export function findProduct(productId) {
  return PRODUCTS.find((p) => p.id === productId);
}

export function productDetailLabel(p) {
  if (p.rule === 'single_qty') return p.unitLabel;
  if (p.rule === 'spliff_qty') return 'per joint';
  return `${p.joints} joint${p.joints > 1 ? 's' : ''}`;
}

export function breakdownToConfigSelection(product, breakdown) {
  if (!product) return {};
  if (product.rule === 'choose_any' || product.rule === 'spliff_qty') return { ...(breakdown || {}) };
  if (product.rule === 'choose_variety') {
    const sel = { ...(breakdown || {}) };
    delete sel.classic;
    return sel;
  }
  if (product.rule === 'single_qty') {
    return { qty: (breakdown || {})[product.categoryId] || 0 };
  }
  return {};
}

export function configTotalSelected(configSelection) {
  return Object.values(configSelection).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
}

export function buildLineFromConfig(product, configSelection) {
  let breakdown = {};
  let lineTotal = 0;
  let detail = '';

  if (product.rule === 'choose_any') {
    breakdown = { ...configSelection };
    lineTotal = product.price;
    detail = Object.entries(breakdown)
      .map(([id, qty]) => `${CAT_MAP[id].name} x${qty}`)
      .join(', ');
  } else if (product.rule === 'choose_variety') {
    breakdown = { ...configSelection, classic: 1 };
    lineTotal = product.price;
    detail =
      FLAVOR_POOL.filter((id) => configSelection[id] > 0)
        .map((id) => `${CAT_MAP[id].name} x${configSelection[id]}`)
        .join(', ') + ' + Plain';
  } else if (product.rule === 'single_qty') {
    breakdown = { [product.categoryId]: configSelection.qty };
    lineTotal = configSelection.qty * product.unitPrice;
    detail = `x${configSelection.qty}`;
  } else if (product.rule === 'spliff_qty') {
    SPLIFF_POOL.forEach((id) => {
      if (configSelection[id] > 0) breakdown[id] = configSelection[id];
    });
    const totalQty = Object.values(breakdown).reduce((a, b) => a + b, 0);
    lineTotal = totalQty * product.unitPrice;
    detail = Object.entries(breakdown)
      .map(([id, qty]) => `${CAT_MAP[id].sub} x${qty}`)
      .join(', ');
  }

  return { breakdown, lineTotal, detail };
}

export function renderProductPickList() {
  let inner = `
    <div class="modal-header">
      <div class="modal-title">Add item</div>
      <button class="modal-close" id="productPickClose" type="button">✕</button>
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
  return inner;
}

export function renderProductConfigView(product, configSelection, draftStock, isEditing = false) {
  if (!product) return '';

  let inner = `
    <div class="modal-header">
      <div class="modal-title">${isEditing ? `Edit — ${escapeHtml(product.name)}` : escapeHtml(product.name)}</div>
      <button class="modal-close" id="productConfigClose" type="button">✕</button>
    </div>`;

  if (product.rule === 'choose_any') {
    inner += `<div class="modal-price">${fmtUGX(product.price)}</div>`;
    inner += `<div class="modal-progress">Selected ${configTotalSelected(configSelection)} / ${product.joints}</div>`;
    FLAVOR_POOL.forEach((id) => {
      const cat = CAT_MAP[id];
      const chosen = configSelection[id] || 0;
      const remaining = product.joints - configTotalSelected(configSelection);
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
    const ready = configTotalSelected(configSelection) === product.joints;
    inner += `<div class="modal-btns">
      <button class="modal-btn cancel" id="productConfigBack" type="button">‹ Back</button>
      <button class="modal-btn confirm" id="productConfigConfirm" ${ready ? '' : 'disabled'} type="button">${isEditing ? 'Save changes' : 'Add to order'}</button>
    </div>`;
  } else if (product.rule === 'choose_variety') {
    inner += `<div class="modal-price">${fmtUGX(product.price)}</div>`;
    const flavorTarget = product.joints - 1;
    const flavorSelected = configTotalSelected(configSelection);
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
      <button class="modal-btn cancel" id="productConfigBack" type="button">‹ Back</button>
      <button class="modal-btn confirm" id="productConfigConfirm" ${ready ? '' : 'disabled'} type="button">${isEditing ? 'Save changes' : 'Add to order'}</button>
    </div>`;
  } else if (product.rule === 'single_qty') {
    const qty = configSelection.qty || 0;
    const catId = product.categoryId;
    inner += `<div class="modal-progress">In stock: ${draftStock[catId]}</div>`;
    inner += `<input type="text" inputmode="numeric" pattern="[0-9]*" id="qtyField" class="qty-input" placeholder="0" value="${qty || ''}" autocomplete="off" />`;
    inner += `<div class="modal-price" id="qtyLinePrice" style="margin-top:10px;">${fmtUGX((qty || 0) * product.unitPrice)}</div>`;
    const ready = qty > 0 && qty <= draftStock[catId];
    inner += `<div class="modal-btns">
      <button class="modal-btn cancel" id="productConfigBack" type="button">‹ Back</button>
      <button class="modal-btn confirm" id="productConfigConfirm" ${ready ? '' : 'disabled'} type="button">${isEditing ? 'Save changes' : 'Add to order'}</button>
    </div>`;
  } else if (product.rule === 'spliff_qty') {
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
    inner += `<div class="modal-price" id="qtyLinePrice" style="margin-top:10px;">${fmtUGX(totalQty * product.unitPrice)}</div>`;
    const overStock = SPLIFF_POOL.some((id) => (configSelection[id] || 0) > draftStock[id]);
    const ready = totalQty > 0 && !overStock;
    inner += `<div class="modal-btns">
      <button class="modal-btn cancel" id="productConfigBack" type="button">‹ Back</button>
      <button class="modal-btn confirm" id="productConfigConfirm" ${ready ? '' : 'disabled'} type="button">${isEditing ? 'Save changes' : 'Add to order'}</button>
    </div>`;
  }

  return inner;
}

export function wireProductConfigView(container, { configSelection, onBack, onConfirm, onRerender }) {
  container.querySelector('#productConfigBack')?.addEventListener('click', onBack);

  container.querySelectorAll('button.mini-step').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.pick;
      const dir = parseInt(btn.dataset.pdir, 10);
      configSelection[id] = Math.max(0, (configSelection[id] || 0) + dir);
      if (configSelection[id] === 0) delete configSelection[id];
      onRerender();
    });
  });

  const qtyField = container.querySelector('#qtyField');
  if (qtyField) {
    qtyField.focus();
    qtyField.addEventListener('input', () => {
      qtyField.value = qtyField.value.replace(/[^0-9]/g, '');
      configSelection.qty = parseInt(qtyField.value, 10) || 0;
      onRerender();
      const el = container.querySelector('#qtyField');
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }

  container.querySelectorAll('[data-spliff-qty]').forEach((inputEl) => {
    inputEl.addEventListener('input', () => {
      inputEl.value = inputEl.value.replace(/[^0-9]/g, '');
      const id = inputEl.dataset.spliffQty;
      configSelection[id] = parseInt(inputEl.value, 10) || 0;
      onRerender();
      const el = container.querySelector(`[data-spliff-qty="${id}"]`);
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  });

  container.querySelector('#productConfigConfirm')?.addEventListener('click', onConfirm);
}
