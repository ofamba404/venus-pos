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

/** Near-white flavors (coconut, pale bangis) need a husk-warm accent so selection chrome isn't invisible. */
function flavorAccent(color) {
  const hex = String(color || '').replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  if (full.length !== 6) return color;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (luma < 0.86) return color;
  const mix = (channel, toward) => Math.round(channel * 0.28 + toward * 0.72);
  const ar = mix(r, 194);
  const ag = mix(g, 152);
  const ab = mix(b, 108);
  return `#${[ar, ag, ab].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

function flavorStyle(color) {
  return `--flavor:${color};--flavor-accent:${flavorAccent(color)}`;
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
        <div class="flavor-meter__fill" data-meter="${(pct / 100).toFixed(3)}"></div>
      </div>
    </div>`;
}

/** Which qty control is in manual type-in mode (`'qty'` or a category id). */
let manualQtyEditKey = null;

export function clearManualQtyEdit() {
  manualQtyEditKey = null;
}

function qtyCountControlHtml({ id, chosen, editable, label }) {
  if (editable && manualQtyEditKey === id) {
    const inputId = id === 'qty' ? ' id="qtyField"' : '';
    return `<input type="text" inputmode="numeric" pattern="[0-9]*"${inputId} class="flavor-qty-input" data-qty-edit="${id}" value="${chosen || ''}" placeholder="0" aria-label="${escapeHtml(label)} quantity" autocomplete="off" />`;
  }
  if (editable) {
    return `<button type="button" class="flavor-count flavor-count--tap" data-qty-tap="${id}" aria-label="Edit ${escapeHtml(label)} quantity, currently ${chosen}">${chosen}</button>`;
  }
  return `<span class="flavor-count" aria-live="polite">${chosen}</span>`;
}

function qtyStepperHtml({ id, label, chosen, canAdd, canRemove, editable = false }) {
  return `
    <div class="flavor-stepper" role="group" aria-label="${escapeHtml(label)} quantity">
      <button class="flavor-step" data-pick="${id}" data-pdir="-1" ${canRemove ? '' : 'disabled'} type="button" aria-label="Remove ${escapeHtml(label)}">−</button>
      ${qtyCountControlHtml({ id, chosen, editable, label })}
      <button class="flavor-step flavor-step--add" data-pick="${id}" data-pdir="1" ${canAdd ? '' : 'disabled'} type="button" aria-label="Add ${escapeHtml(label)}">+</button>
    </div>`;
}

function flavorSwatchHtml({ id, label, color, chosen, stock, canAdd, canRemove, editable = false }) {
  const active = chosen > 0;
  const out = stock <= 0;
  return `
    <div class="flavor-row${active ? ' is-active' : ''}${out ? ' is-out' : ''}" style="${flavorStyle(color)}" data-flavor="${id}">
      <div class="flavor-orb" aria-hidden="true">
        <span class="flavor-orb__glow"></span>
        <span class="flavor-orb__core"></span>
      </div>
      <div class="flavor-row__meta">
        <div class="flavor-row__name">${escapeHtml(label)}</div>
        <div class="flavor-row__stock">${out ? 'Out of stock' : `${stock} available`}</div>
      </div>
      ${qtyStepperHtml({ id, label, chosen, canAdd, canRemove, editable })}
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
      <div class="flavor-fixed${plainOk ? '' : ' is-out'}" style="${flavorStyle(plain.color)}">
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
    const cat = CAT_MAP[catId];
    const stock = draftStock[catId] || 0;
    inner += `<div class="modal-progress">In stock: ${stock}</div>`;
    inner += `<div class="flavor-list">`;
    // Stepper uses selection key `qty` (not category id) — matches buildLineFromConfig.
    inner += flavorSwatchHtml({
      id: 'qty',
      label: cat?.name || product.name,
      color: cat?.color || '#a6752e',
      chosen: qty,
      stock,
      canAdd: qty < stock,
      canRemove: qty > 0,
      editable: true,
    });
    inner += `</div>`;
    inner += `<div class="modal-price" id="qtyLinePrice" style="margin-top:10px;">${fmtUGX(qty * product.unitPrice)}</div>`;
    inner += configFooterHtml({
      ready: qty > 0 && qty <= stock,
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
      inner += flavorSwatchHtml({
        id,
        label: `Bangis ${cat.sub}`,
        color: cat.color,
        chosen: qty,
        stock,
        canAdd: qty < stock,
        canRemove: qty > 0,
        editable: true,
      });
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
  const endManualAnd = (fn) => () => {
    clearManualQtyEdit();
    fn();
  };

  if (onClose) {
    container.querySelector(`#${closeId}`)?.addEventListener('click', endManualAnd(onClose));
  }
  container.querySelector(`#${backId}`)?.addEventListener('click', endManualAnd(onBack));

  container.querySelectorAll('button.mini-step, button.flavor-step').forEach((btn) => {
    btn.addEventListener('click', () => {
      clearManualQtyEdit();
      const id = btn.dataset.pick;
      const dir = parseInt(btn.dataset.pdir, 10);
      configSelection[id] = Math.max(0, (configSelection[id] || 0) + dir);
      if (configSelection[id] === 0) delete configSelection[id];
      onRerender();
    });
  });

  container.querySelectorAll('[data-qty-tap]').forEach((btn) => {
    btn.addEventListener('click', () => {
      manualQtyEditKey = btn.dataset.qtyTap;
      onRerender();
    });
  });

  container.querySelectorAll('[data-qty-edit]').forEach((inputEl) => {
    const id = inputEl.dataset.qtyEdit;
    inputEl.addEventListener('input', () => {
      inputEl.value = inputEl.value.replace(/[^0-9]/g, '');
      const next = parseInt(inputEl.value, 10) || 0;
      if (next > 0) configSelection[id] = next;
      else delete configSelection[id];
      onRerender();
    });
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        inputEl.blur();
      }
    });
    // Defer: DOM detach during re-render fires blur; ignore if a qty input is still focused.
    inputEl.addEventListener('blur', () => {
      setTimeout(() => {
        if (document.activeElement?.matches?.('[data-qty-edit]')) return;
        if (manualQtyEditKey == null) return;
        clearManualQtyEdit();
        onRerender();
      }, 0);
    });
  });

  const editEl = container.querySelector('[data-qty-edit]');
  if (editEl) {
    editEl.focus();
    const len = editEl.value.length;
    editEl.setSelectionRange(len, len);
  }

  container.querySelector(`#${confirmId}`)?.addEventListener('click', endManualAnd(onConfirm));
}
