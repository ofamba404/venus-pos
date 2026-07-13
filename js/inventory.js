import { sbFetch } from './api.js';
import { readStaleCache, writeCache } from './cache.js';
import { bumpElement, closeModal, openModal } from './animations.js';
import {
  CATEGORIES,
  CAT_MAP,
  COOKIE_LOW_PCT,
  COOKIE_STOCK_CAPACITY,
  LOW_STOCK_THRESHOLD,
  getPageHref,
} from './config.js';
import { inventory, draftStock } from './state.js';
import { showToast } from './utils.js';
import { showPlaceholder, stockStatusPlaceholder } from './pending.js';

const HIGHLIGHT_KEY = 'venus-pos-stock-highlight';

export function getActiveStatusHighlight() {
  try {
    return sessionStorage.getItem(HIGHLIGHT_KEY);
  } catch {
    return null;
  }
}

export function setActiveStatusHighlight(status) {
  try {
    if (status) sessionStorage.setItem(HIGHLIGHT_KEY, status);
    else sessionStorage.removeItem(HIGHLIGHT_KEY);
  } catch {
    /* ignore */
  }
}

export async function persistStock(id) {
  try {
    const res = await sbFetch(`inventory?category_id=eq.${id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ stock: inventory[id], updated_at: new Date().toISOString() }),
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    writeCache(
      'inventory',
      CATEGORIES.map((c) => ({ category_id: c.id, stock: inventory[c.id] })),
    );
  } catch (e) {
    console.error('persist stock failed', e);
    showToast('Could not save — check connection', true);
  }
}

export function refreshInvCard(id) {
  const el = document.getElementById(`inv-count-${id}`);
  if (!el) return;
  el.textContent = inventory[id];
  bumpElement(el);
  const card = el.closest('.card');
  if (card) bumpElement(card);
}

export function adjustStock(id, delta) {
  inventory[id] = Math.max(0, inventory[id] + delta);
  draftStock[id] = inventory[id];
  refreshInvCard(id);
  persistStock(id);
  renderStockGlance();
}

function startEditCount(el) {
  const id = el.id.replace('inv-count-', '');
  const current = inventory[id];
  const chWidth = Math.max(String(current).length, 1) + 0.3;
  el.innerHTML = `<input type="text" inputmode="numeric" pattern="[0-9]*" class="count-edit-input" style="width:${chWidth}ch;" value="${current}" />`;
  const input = el.querySelector('input');
  input.focus();
  input.select();
  let settled = false;
  const commit = () => {
    if (settled) return;
    settled = true;
    finishEditCount(id, input.value, current);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') {
      settled = true;
      el.textContent = current;
    }
  });
  input.addEventListener('blur', commit);
  input.addEventListener('input', () => {
    input.value = input.value.replace(/[^0-9]/g, '');
    input.style.width = `${Math.max(input.value.length, 1) + 0.3}ch`;
  });
}

function finishEditCount(id, value, fallback) {
  const el = document.getElementById(`inv-count-${id}`);
  const num = parseInt(value, 10);
  if (!isNaN(num) && num >= 0) {
    inventory[id] = num;
    draftStock[id] = num;
    if (el) el.textContent = num;
    persistStock(id);
    renderStockGlance();
  } else if (el) {
    el.textContent = fallback;
  }
}

export function buildInvCard(cat) {
  const card = document.createElement('div');
  card.className = 'card';
  card.style.setProperty('--accent', cat.color);
  card.innerHTML = `
    <div class="name-row">
      <span class="name">${cat.name}</span>
      <span class="dot" style="background:${cat.color}"></span>
      ${cat.sub ? `<span class="sub-label">${cat.sub}</span>` : ''}
    </div>
    <div class="counter-row">
      <div class="count" id="inv-count-${cat.id}">${inventory[cat.id] ?? 0}</div>
      <div class="btns">
        <button class="step minus" data-id="${cat.id}" data-dir="-1" type="button" aria-label="Remove one">–</button>
        <button class="step plus" data-id="${cat.id}" data-dir="1" type="button" aria-label="Add one">+</button>
      </div>
    </div>
  `;
  return card;
}

export function renderInventoryGrid() {
  const invGrid = document.getElementById('invGrid');
  if (!invGrid) return;

  const pending = showPlaceholder('inventory');
  invGrid.innerHTML = '';
  CATEGORIES.forEach((cat) => {
    const card = buildInvCard(cat);
    const countEl = card.querySelector('.count');
    if (pending && countEl) {
      countEl.classList.add('is-pending');
      countEl.textContent = '··';
    }
    invGrid.appendChild(card);
  });
}

function applyInventoryRows(rows) {
  rows.forEach((row) => {
    if (Object.hasOwn(inventory, row.category_id)) {
      inventory[row.category_id] = row.stock;
      draftStock[row.category_id] = row.stock;
      const el = document.getElementById(`inv-count-${row.category_id}`);
      if (el) el.textContent = row.stock;
    }
  });
}

export function restoreInventoryFromCache() {
  const stale = readStaleCache('inventory');
  if (!stale?.length) return false;
  applyInventoryRows(stale);
  return true;
}

export function syncInventoryToDom() {
  CATEGORIES.forEach((cat) => {
    const el = document.getElementById(`inv-count-${cat.id}`);
    if (!el || el.querySelector('input')) return;
    el.classList.remove('is-pending');
    el.textContent = inventory[cat.id];
  });
}

export async function loadInventory() {
  const hadData = Object.values(inventory).some((n) => n > 0);

  try {
    const res = await sbFetch('inventory?select=category_id,stock');
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    const rows = await res.json();
    writeCache('inventory', rows);
    applyInventoryRows(rows);
  } catch (e) {
    console.error('load inventory failed', e);
    if (!hadData && !Object.values(inventory).some((n) => n > 0)) {
      showToast('Could not load inventory', true);
    }
  }
  syncInventoryToDom();
  renderStockGlance();
}

function isCookieCategory(cat) {
  return cat.id === 'cookie';
}

function countByStatus(categories) {
  const out = categories.filter((c) => inventory[c.id] === 0).length;
  const low = categories.filter((c) => inventory[c.id] > 0 && inventory[c.id] < LOW_STOCK_THRESHOLD).length;
  const ok = categories.length - out - low;
  return { ok, low, out };
}

function buildDonutGradient(categories, total) {
  if (total === 0) return 'var(--btn-bg)';
  let cursor = 0;
  const stops = [];
  categories.forEach((c) => {
    const stock = inventory[c.id];
    if (stock <= 0) return;
    const start = cursor;
    const end = cursor + (stock / total) * 100;
    stops.push(`${c.color} ${start}% ${end}%`);
    cursor = end;
  });
  return stops.length ? `conic-gradient(${stops.join(', ')})` : 'var(--btn-bg)';
}

function formatStatusParts({ ok, low, out }, showZeros = true) {
  const parts = [];
  if (showZeros || ok) parts.push(`<span class="ds-ok">${ok} well stocked</span>`);
  if (showZeros || low) parts.push(`<span class="ds-low">${low} running low</span>`);
  if (showZeros || out) parts.push(`<span class="ds-out">${out} out of stock</span>`);
  return parts.length ? parts.join('<span class="ds-sep">·</span>') : '<span class="ds-out">out of stock</span>';
}

function cookieStockLevel(stock) {
  const pct = stock <= 0 ? 0 : Math.min(100, Math.round((stock / COOKIE_STOCK_CAPACITY) * 100));
  if (stock === 0) return { pct, state: 'out' };
  const lowCutoff = Math.max(LOW_STOCK_THRESHOLD, Math.round(COOKIE_STOCK_CAPACITY * COOKIE_LOW_PCT));
  if (stock < lowCutoff) return { pct, state: 'low' };
  return { pct, state: 'ok' };
}

function renderStatusGroup(label, status, typeClass, statsHtml) {
  return `
    <div class="ds-group ${typeClass}">
      <div class="ds-group-label">${label}</div>
      <div class="ds-group-stats">${statsHtml ?? formatStatusParts(status)}</div>
    </div>`;
}

export function renderStockGlance() {
  const donutJoints = document.getElementById('donutJoints');
  const donutJointsTotal = document.getElementById('donutJointsTotal');
  const cookieStockTotal = document.getElementById('cookieStockTotal');
  const cookieStockFill = document.getElementById('cookieStockFill');
  const donutStatus = document.getElementById('donutStatus');
  if (!donutJoints) return;

  const jointCats = CATEGORIES.filter((c) => !isCookieCategory(c));
  const cookieCats = CATEGORIES.filter(isCookieCategory);

  const jointsTotal = jointCats.reduce((sum, c) => sum + inventory[c.id], 0);
  const cookiesTotal = cookieCats.reduce((sum, c) => sum + inventory[c.id], 0);
  const stockPending = showPlaceholder('inventory');

  if (donutJointsTotal) {
    donutJointsTotal.classList.toggle('is-pending', stockPending);
    donutJointsTotal.textContent = stockPending ? '—' : String(jointsTotal);
  }
  donutJoints.style.background = stockPending ? 'var(--btn-bg)' : buildDonutGradient(jointCats, jointsTotal);

  if (cookieStockTotal) {
    cookieStockTotal.classList.toggle('is-pending', stockPending);
    cookieStockTotal.textContent = stockPending ? '—' : String(cookiesTotal);
  }
  if (cookieStockFill) {
    const meter = cookieStockLevel(cookiesTotal);
    cookieStockFill.style.width = stockPending ? '0%' : `${meter.pct}%`;
    cookieStockFill.dataset.state = stockPending ? 'ok' : meter.state;
  }

  if (donutStatus) {
    donutStatus.innerHTML = showPlaceholder('inventory')
      ? stockStatusPlaceholder()
      : renderStatusGroup('Joints', countByStatus(jointCats), 'ds-joints');
  }

  donutStatus.querySelectorAll('.ds-ok, .ds-low, .ds-out').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const status = chip.classList.contains('ds-low') ? 'low' : chip.classList.contains('ds-out') ? 'out' : 'ok';
      setActiveStatusHighlight(status);
      window.location.href = getPageHref('analytics', '#stock');
    });
  });
}

export function applyActiveHighlight() {
  const highlight = getActiveStatusHighlight();
  document.querySelectorAll('.bar-fill').forEach((f) => f.classList.remove('glow-ok', 'glow-low', 'glow-out'));
  if (!highlight) return;
  document.querySelectorAll(`.bar-row[data-status="${highlight}"] .bar-fill`).forEach((f) => {
    f.classList.add(`glow-${highlight}`);
  });
}

export function wireInventoryPage() {
  const invGrid = document.getElementById('invGrid');
  if (!invGrid) return;

  const DOUBLE_TAP_MS = 280;
  let lastTapButton = null;
  let lastTapTime = 0;
  let singleTapTimer = null;

  const amountModal = document.getElementById('amountModal');
  const amountModalTitle = document.getElementById('amountModalTitle');
  const amountInput = document.getElementById('amountInput');
  let amountContext = null;

  function openAmountModal(id, dir) {
    const cat = CAT_MAP[id];
    const label = cat.sub ? `${cat.name} ${cat.sub}` : cat.name;
    amountModalTitle.textContent = dir > 0 ? `Add stock — ${label}` : `Remove stock — ${label}`;
    amountContext = { id, dir };
    amountInput.value = '';
    openModal(amountModal);
    setTimeout(() => amountInput.focus(), 50);
  }

  function closeAmountModal() {
    closeModal(amountModal);
    amountContext = null;
  }

  function applyAmountModal() {
    if (!amountContext) return;
    const amount = parseInt(amountInput.value, 10);
    if (!isNaN(amount) && amount > 0) adjustStock(amountContext.id, amountContext.dir * amount);
    closeAmountModal();
  }

  document.getElementById('amountCancel')?.addEventListener('click', closeAmountModal);
  document.getElementById('amountConfirm')?.addEventListener('click', applyAmountModal);
  amountModal?.addEventListener('click', (e) => {
    if (e.target === amountModal) closeAmountModal();
  });
  amountInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyAmountModal();
    if (e.key === 'Escape') closeAmountModal();
  });
  amountInput?.addEventListener('input', () => {
    amountInput.value = amountInput.value.replace(/[^0-9]/g, '');
  });

  invGrid.addEventListener('click', (e) => {
    const countEl = e.target.closest('.count');
    if (countEl && !countEl.querySelector('input')) {
      startEditCount(countEl);
      return;
    }
    const btn = e.target.closest('button.step');
    if (!btn) return;
    const id = btn.dataset.id;
    const dir = parseInt(btn.dataset.dir, 10);
    const now = Date.now();
    if (btn === lastTapButton && now - lastTapTime < DOUBLE_TAP_MS) {
      clearTimeout(singleTapTimer);
      lastTapButton = null;
      openAmountModal(id, dir);
      return;
    }
    lastTapButton = btn;
    lastTapTime = now;
    clearTimeout(singleTapTimer);
    singleTapTimer = setTimeout(() => {
      adjustStock(id, dir);
      lastTapButton = null;
    }, DOUBLE_TAP_MS);
  });
}
