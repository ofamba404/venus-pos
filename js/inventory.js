import { sbFetch } from './api.js';
import { readStaleCache, writeCache } from './cache.js';
import { CATEGORIES, CAT_MAP, LOW_STOCK_THRESHOLD, getPageHref } from './config.js';
import { inventory, draftStock } from './state.js';
import { showToast } from './utils.js';

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
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
  const card = el.closest('.card');
  card?.classList.add('pulse');
  setTimeout(() => card?.classList.remove('pulse'), 200);
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
  invGrid.innerHTML = '';
  CATEGORIES.forEach((cat) => invGrid.appendChild(buildInvCard(cat)));
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
    if (el && !el.querySelector('input')) el.textContent = inventory[cat.id];
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

export function renderStockGlance() {
  const donutRing = document.getElementById('donutRing');
  const donutTotal = document.getElementById('donutTotal');
  const donutStatus = document.getElementById('donutStatus');
  if (!donutRing) return;

  const total = CATEGORIES.reduce((sum, c) => sum + inventory[c.id], 0);
  donutTotal.textContent = total;

  if (total === 0) {
    donutRing.style.background = 'var(--btn-bg)';
  } else {
    let cursor = 0;
    const stops = [];
    CATEGORIES.forEach((c) => {
      const stock = inventory[c.id];
      if (stock <= 0) return;
      const start = cursor;
      const end = cursor + (stock / total) * 100;
      stops.push(`${c.color} ${start}% ${end}%`);
      cursor = end;
    });
    donutRing.style.background = `conic-gradient(${stops.join(', ')})`;
  }

  const outCount = CATEGORIES.filter((c) => inventory[c.id] === 0).length;
  const lowCount = CATEGORIES.filter((c) => inventory[c.id] > 0 && inventory[c.id] < LOW_STOCK_THRESHOLD).length;
  const okCount = CATEGORIES.length - outCount - lowCount;

  donutStatus.innerHTML = `
    <div class="ds-row ds-ok" data-status-link="ok"><span class="ds-dot"></span>${okCount} well stocked</div>
    <div class="ds-row ds-low" data-status-link="low"><span class="ds-dot"></span>${lowCount} running low</div>
    <div class="ds-row ds-out" data-status-link="out"><span class="ds-dot"></span>${outCount} out of stock</div>
  `;

  donutStatus.querySelectorAll('[data-status-link]').forEach((row) => {
    row.addEventListener('click', () => {
      setActiveStatusHighlight(row.dataset.statusLink);
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
    amountModal.hidden = false;
    setTimeout(() => amountInput.focus(), 50);
  }

  function closeAmountModal() {
    amountModal.hidden = true;
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
