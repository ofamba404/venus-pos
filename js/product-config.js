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

const PACK_PRODUCTS = PRODUCTS.filter((p) => p.rule === 'choose_any' || p.rule === 'choose_variety');
const SINGLE_PRODUCTS = PRODUCTS.filter((p) => p.rule === 'single_qty' || p.rule === 'spliff_qty');

export function productPickButtonHtml(p) {
  return `
    <button class="product-row pick-product-card" type="button" data-product="${p.id}">
      <div class="pick-product-card__main">
        <div class="pname">${escapeHtml(p.name)}</div>
        <div class="pcount">${productDetailLabel(p)}</div>
      </div>
      <div class="p-right">
        <div class="pprice">${fmtUGX(p.price || p.unitPrice)}</div>
      </div>
    </button>`;
}

export function renderProductPickPanel() {
  return `
    <div class="pick-product-panel">
      <section class="pick-product-section" aria-label="Packs">
        <div class="pick-product-section-label">Packs</div>
        <div class="pick-product-list">
          ${PACK_PRODUCTS.map(productPickButtonHtml).join('')}
        </div>
      </section>
      <section class="pick-product-section" aria-label="Singles">
        <div class="pick-product-section-label">Singles</div>
        <div class="pick-product-grid">
          ${SINGLE_PRODUCTS.map(productPickButtonHtml).join('')}
        </div>
      </section>
    </div>`;
}

export function wireProductPickButtons(root, onPick) {
  root.querySelectorAll('[data-product]').forEach((row) => {
    row.addEventListener('click', () => onPick(row.dataset.product, row));
  });
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

export function renderProductPickList({ backId = 'productPickBack', backLabel = 'Back' } = {}) {
  return `
    <div class="modal-header">
      <div class="modal-title">Add item</div>
      <button class="modal-close" id="productPickClose" type="button">✕</button>
    </div>
    ${renderProductPickPanel()}
    <div class="modal-btns pick-footer">
      <button class="modal-btn cancel" id="${backId}" type="button">${backLabel}</button>
    </div>`;
}

function jointSlotsHtml(selected, target) {
  const pct = target > 0 ? Math.min(100, (selected / target) * 100) : 0;
  return `
    <div class="flavor-meter" role="status" aria-live="polite" aria-label="${selected} of ${target} joints selected">
      <div class="flavor-meter__copy">
        <span class="flavor-meter__count">${selected}</span>
        <span class="flavor-meter__of">of ${target}</span>
      </div>
      <div class="flavor-meter__track">
        <div class="flavor-meter__fill" style="--meter:${(pct / 100).toFixed(3)}"></div>
      </div>
    </div>`;
}

function flavorSwatchHtml({ id, label, color, chosen, stock, canAdd, canRemove }) {
  const active = chosen > 0;
  const out = stock <= 0;
  return `
    <div class="flavor-row${active ? ' is-active' : ''}${out ? ' is-out' : ''}" style="--flavor:${color}" data-flavor="${id}">
      <div class="flavor-orb" aria-hidden="true">
        <span class="flavor-orb__glow"></span>
        <span class="flavor-orb__core"></span>
      </div>
      <div class="flavor-row__meta">
        <div class="flavor-row__name">${escapeHtml(label)}</div>
        <div class="flavor-row__stock">${out ? 'Out of stock' : `${stock} available`}</div>
      </div>
      <div class="flavor-stepper" role="group" aria-label="${escapeHtml(label)} quantity">
        <button class="flavor-step" data-pick="${id}" data-pdir="-1" ${canRemove ? '' : 'disabled'} type="button" aria-label="Remove ${escapeHtml(label)}">−</button>
        <span class="flavor-count" aria-live="polite">${chosen}</span>
        <button class="flavor-step flavor-step--add" data-pick="${id}" data-pdir="1" ${canAdd ? '' : 'disabled'} type="button" aria-label="Add ${escapeHtml(label)}">+</button>
      </div>
    </div>`;
}

function flavorPaletteHtml(configSelection, draftStock, target) {
  const selected = configTotalSelected(configSelection);
  const remaining = target - selected;
  return `
    <div class="flavor-list">
      ${FLAVOR_POOL.map((id) => {
        const cat = CAT_MAP[id];
        const chosen = configSelection[id] || 0;
        const stock = draftStock[id] || 0;
        return flavorSwatchHtml({
          id,
          label: cat.name,
          color: cat.color,
          chosen,
          stock,
          canAdd: remaining > 0 && chosen < stock,
          canRemove: chosen > 0,
        });
      }).join('')}
    </div>`;
}

function configFooterHtml({ ready, isEditing, closeId, backId, confirmId, confirmLabel }) {
  return `
    <div class="modal-btns config-footer">
      <button class="modal-btn cancel" id="${backId}" type="button">Back</button>
      <button class="modal-btn confirm" id="${confirmId}" ${ready ? '' : 'disabled'} type="button">${confirmLabel || (isEditing ? 'Save changes' : 'Add to order')}</button>
    </div>`;
}

export function renderProductConfigView(
  product,
  configSelection,
  draftStock,
  isEditing = false,
  {
    closeId = 'productConfigClose',
    backId = 'productConfigBack',
    confirmId = 'productConfigConfirm',
  } = {},
) {
  if (!product) return '';

  let inner = `
    <div class="modal-header">
      <div class="modal-title">${isEditing ? `Edit — ${escapeHtml(product.name)}` : escapeHtml(product.name)}</div>
      <button class="modal-close" id="${closeId}" type="button">✕</button>
    </div>`;

  if (product.rule === 'choose_any') {
    const selected = configTotalSelected(configSelection);
    inner += `<div class="modal-price">${fmtUGX(product.price)}</div>`;
    inner += jointSlotsHtml(selected, product.joints);
    inner += flavorPaletteHtml(configSelection, draftStock, product.joints);
    inner += configFooterHtml({
      ready: selected === product.joints,
      isEditing,
      closeId,
      backId,
      confirmId,
    });
  } else if (product.rule === 'choose_variety') {
    const flavorTarget = product.joints - 1;
    const flavorSelected = configTotalSelected(configSelection);
    const plainOk = (draftStock.classic || 0) >= 1;
    const plain = CAT_MAP.classic;
    inner += `<div class="modal-price">${fmtUGX(product.price)}</div>`;
    inner += jointSlotsHtml(flavorSelected, flavorTarget);
    inner += flavorPaletteHtml(configSelection, draftStock, flavorTarget);
    inner += `
      <div class="flavor-fixed${plainOk ? '' : ' is-out'}" style="--flavor:${plain.color}">
        <div class="flavor-orb" aria-hidden="true">
          <span class="flavor-orb__glow"></span>
          <span class="flavor-orb__core"></span>
        </div>
        <div class="flavor-row__meta">
          <div class="flavor-row__name">Plain</div>
          <div class="flavor-row__stock">Always included</div>
        </div>
        <span class="flavor-fixed__badge ${plainOk ? 'ok' : 'no'}">${plainOk ? '×1' : 'Out'}</span>
      </div>`;
    inner += configFooterHtml({
      ready: flavorSelected === flavorTarget && plainOk,
      isEditing,
      closeId,
      backId,
      confirmId,
    });
  } else if (product.rule === 'single_qty') {
    const qty = configSelection.qty || 0;
    const catId = product.categoryId;
    inner += `<div class="modal-progress">In stock: ${draftStock[catId]}</div>`;
    inner += `<input type="text" inputmode="numeric" pattern="[0-9]*" id="qtyField" class="qty-input" placeholder="0" value="${qty || ''}" autocomplete="off" />`;
    inner += `<div class="modal-price" id="qtyLinePrice" style="margin-top:10px;">${fmtUGX((qty || 0) * product.unitPrice)}</div>`;
    inner += configFooterHtml({
      ready: qty > 0 && qty <= draftStock[catId],
      isEditing,
      closeId,
      backId,
      confirmId,
    });
  } else if (product.rule === 'spliff_qty') {
    inner += `<div class="modal-progress">Enter quantity for each</div>`;
    inner += `<div class="flavor-list">`;
    SPLIFF_POOL.forEach((id) => {
      const cat = CAT_MAP[id];
      const qty = configSelection[id] || 0;
      const stock = draftStock[id] || 0;
      inner += `
        <div class="flavor-row flavor-row--input${qty > 0 ? ' is-active' : ''}${stock <= 0 ? ' is-out' : ''}" style="--flavor:${cat.color}">
          <div class="flavor-orb" aria-hidden="true">
            <span class="flavor-orb__glow"></span>
            <span class="flavor-orb__core"></span>
          </div>
          <div class="flavor-row__meta">
            <div class="flavor-row__name">Bangis ${escapeHtml(cat.sub)}</div>
            <div class="flavor-row__stock">${stock <= 0 ? 'Out of stock' : `${stock} available`}</div>
          </div>
          <input type="text" inputmode="numeric" pattern="[0-9]*" class="qty-mini-input flavor-qty-input" data-spliff-qty="${id}" value="${qty || ''}" placeholder="0" aria-label="Bangis ${escapeHtml(cat.sub)} quantity" />
        </div>`;
    });
    inner += `</div>`;
    const totalQty = SPLIFF_POOL.reduce((s, id) => s + (configSelection[id] || 0), 0);
    inner += `<div class="modal-price" id="qtyLinePrice" style="margin-top:10px;">${fmtUGX(totalQty * product.unitPrice)}</div>`;
    const overStock = SPLIFF_POOL.some((id) => (configSelection[id] || 0) > draftStock[id]);
    inner += configFooterHtml({
      ready: totalQty > 0 && !overStock,
      isEditing,
      closeId,
      backId,
      confirmId,
    });
  }

  return inner;
}

export function wireProductConfigView(
  container,
  {
    configSelection,
    onBack,
    onConfirm,
    onRerender,
    closeId = 'productConfigClose',
    backId = 'productConfigBack',
    confirmId = 'productConfigConfirm',
    onClose,
  },
) {
  if (onClose) {
    container.querySelector(`#${closeId}`)?.addEventListener('click', onClose);
  }
  container.querySelector(`#${backId}`)?.addEventListener('click', onBack);

  container.querySelectorAll('button.mini-step, button.flavor-step').forEach((btn) => {
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

  container.querySelector(`#${confirmId}`)?.addEventListener('click', onConfirm);
}
