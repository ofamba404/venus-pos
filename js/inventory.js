import { sbFetch } from './api.js';
import { dataStore } from './store/index.js';
import { bumpElement, closeModal, openModal } from './animations.js';
import {
  CATEGORIES,
  CAT_MAP,
  COOKIE_LOW_PCT,
  COOKIE_STOCK_CAPACITY,
  LOW_STOCK_THRESHOLD,
  isCookieCategoryId,
} from './config.js';
import { navigate } from './router.js';
import { inventory, draftStock } from './state.js';
import { notifyStockCrossing } from './notifications.js';
import { showToast } from './utils.js';
import { showPlaceholder, revealLoaded, stockStatusPlaceholder } from './pending.js';

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
    await upsertInventoryStock(id);
    await dataStore.persistCurrent('inventory');
  } catch (e) {
    console.error('persist stock failed', e);
    showToast('Could not save — check connection', true);
  }
}

/**
 * Save stock for a category. Prefer PATCH (RLS update); insert only when the row is missing.
 */
export async function upsertInventoryStock(id) {
  const payload = { stock: inventory[id], updated_at: new Date().toISOString() };
  const patch = await sbFetch(`inventory?category_id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(payload),
  });
  if (patch.ok) return;

  // Row may not exist yet (new cookie flavor) — insert, then we're done.
  const insert = await sbFetch('inventory', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ category_id: id, ...payload }),
  });
  if (insert.ok) return;

  const detail = await insert.text().catch(() => '');
  throw new Error(`Supabase ${insert.status}${detail ? `: ${detail}` : ''} (patch ${patch.status})`);
}

export function refreshInvCard(id) {
  const el = document.getElementById(`inv-count-${id}`);
  if (!el) return;
  el.textContent = inventory[id];
  bumpElement(el);
}

export function adjustStock(id, delta) {
  const previous = inventory[id];
  inventory[id] = Math.max(0, inventory[id] + delta);
  draftStock[id] = inventory[id];
  refreshInvCard(id);
  persistStock(id);
  renderStockGlance();
  if (delta < 0) void notifyStockCrossing(id, previous, inventory[id]);
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
    const previous = inventory[id];
    inventory[id] = num;
    draftStock[id] = num;
    if (el) el.textContent = num;
    persistStock(id);
    renderStockGlance();
    if (num < previous) void notifyStockCrossing(id, previous, num);
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
  return dataStore.hasData('inventory');
}

export function syncInventoryToDom() {
  CATEGORIES.forEach((cat) => {
    const el = document.getElementById(`inv-count-${cat.id}`);
    if (!el || el.querySelector('input')) return;
    el.classList.remove('is-pending');
    el.textContent = inventory[cat.id];
    revealLoaded(el);
  });
}

export async function loadInventory() {
  await ensureInventoryCategories();
  await dataStore.fetch('inventory');
  syncInventoryToDom();
  renderStockGlance();
}

function isCookieCategory(cat) {
  return isCookieCategoryId(cat?.id);
}

/**
 * Ensure every CATEGORIES id has an inventory row. Migrates legacy aggregate
 * `cookie` stock into butterscotch when any leftover units remain.
 */
export async function ensureInventoryCategories() {
  try {
    const res = await sbFetch('inventory?select=category_id,stock');
    if (!res.ok) return;
    const rows = await res.json();
    if (!Array.isArray(rows)) return;

    const byId = Object.fromEntries(
      rows.map((r) => [r.category_id, Math.max(0, Math.floor(Number(r.stock) || 0))]),
    );
    const legacy = Number(byId.cookie) || 0;
    const now = new Date().toISOString();
    const missing = CATEGORIES.filter((cat) => !Object.hasOwn(byId, cat.id)).map((cat) => ({
      category_id: cat.id,
      stock: 0,
      updated_at: now,
    }));

    if (missing.length) {
      const post = await sbFetch('inventory', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(missing),
      });
      if (!post.ok) {
        console.warn('ensureInventoryCategories insert failed', post.status);
      } else {
        missing.forEach((row) => {
          if (!Object.hasOwn(inventory, row.category_id)) return;
          inventory[row.category_id] = row.stock;
          draftStock[row.category_id] = row.stock;
        });
      }
    }

    if (legacy > 0) {
      const target = 'cookie_butterscotch';
      const next = (Number(byId[target]) || 0) + legacy;
      inventory[target] = next;
      draftStock[target] = next;
      await upsertInventoryStock(target);
      const zeroLegacy = await sbFetch('inventory?category_id=eq.cookie', {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ stock: 0, updated_at: now }),
      });
      if (!zeroLegacy.ok) console.warn('legacy cookie zero failed', zeroLegacy.status);
    }
  } catch (e) {
    console.warn('ensureInventoryCategories', e);
  }
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

/** Cookie fill = stock / 100 capacity; joints use their own relative bar scale. */
export function cookieStockLevel(stock) {
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
    const pct = stockPending ? 0 : meter.pct;
    cookieStockFill.dataset.fillWidth = `${pct}%`;
    cookieStockFill.dataset.state = stockPending ? 'ok' : meter.state;
    cookieStockFill.style.width = '100%';
    cookieStockFill.style.transformOrigin = 'left center';
    cookieStockFill.style.transform = `scaleX(${pct / 100})`;
  }

  if (donutStatus) {
    donutStatus.innerHTML = showPlaceholder('inventory')
      ? stockStatusPlaceholder()
      : [
          renderStatusGroup('Joints', countByStatus(jointCats), 'ds-joints'),
          renderStatusGroup('Cookies', countByStatus(cookieCats), 'ds-cookies'),
        ].join('');
  }

  donutStatus.querySelectorAll('.ds-ok, .ds-low, .ds-out').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const status = chip.classList.contains('ds-low') ? 'low' : chip.classList.contains('ds-out') ? 'out' : 'ok';
      setActiveStatusHighlight(status);
      void navigate('analytics', { hash: '#stock' });
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
  const amountModalPanel = amountModal?.querySelector('.modal');
  const amountModalTitle = document.getElementById('amountModalTitle');
  const amountInput = document.getElementById('amountInput');
  let amountContext = null;

  /**
   * Button/focus solid from a flavor swatch.
   * Pale / pastel colors → richer same-hue tint (HSL) so white Apply text has real contrast.
   * Saturated colors stay as-is.
   */
  function accentActionColor(color) {
    const hex = String(color || '').replace('#', '');
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    if (full.length !== 6) return color || '#059669';
    let r = parseInt(full.slice(0, 2), 16);
    let g = parseInt(full.slice(2, 4), 16);
    let b = parseInt(full.slice(4, 6), 16);
    const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (luma < 0.55) return `#${full}`;

    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r:
          h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
          break;
        case g:
          h = ((b - r) / d + 2) / 6;
          break;
        default:
          h = ((r - g) / d + 4) / 6;
      }
    }

    // Near-white / gray swatches have no usable hue — warm coconut husk.
    if (s < 0.08) {
      h = 32 / 360;
      s = 0.42;
    } else {
      s = Math.min(0.78, Math.max(s * 1.45, 0.48));
    }
    const targetL = 0.36;

    const hue2rgb = (p, q, t) => {
      let tt = t;
      if (tt < 0) tt += 1;
      if (tt > 1) tt -= 1;
      if (tt < 1 / 6) return p + (q - p) * 6 * tt;
      if (tt < 1 / 2) return q;
      if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
      return p;
    };
    const q = targetL < 0.5 ? targetL * (1 + s) : targetL + s - targetL * s;
    const p = 2 * targetL - q;
    const toByte = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, '0');
    return `#${toByte(hue2rgb(p, q, h + 1 / 3))}${toByte(hue2rgb(p, q, h))}${toByte(hue2rgb(p, q, h - 1 / 3))}`;
  }

  function applyAmountTheme(color) {
    const accent = color || '#059669';
    const action = accentActionColor(accent);
    for (const el of [amountModal, amountModalPanel]) {
      if (!el) continue;
      el.style.setProperty('--accent', accent);
      el.style.setProperty('--accent-action', action);
    }
  }

  function clearAmountTheme() {
    for (const el of [amountModal, amountModalPanel]) {
      if (!el) continue;
      el.style.removeProperty('--accent');
      el.style.removeProperty('--accent-action');
    }
  }

  function openAmountModal(id, dir) {
    const cat = CAT_MAP[id];
    const label = cat.sub ? `${cat.name} ${cat.sub}` : cat.name;
    amountModalTitle.textContent = dir > 0 ? `Add stock — ${label}` : `Remove stock — ${label}`;
    amountContext = { id, dir };
    amountInput.value = '';
    applyAmountTheme(cat?.color);
    openModal(amountModal);
    setTimeout(() => amountInput?.focus({ preventScroll: true }), 50);
  }

  function closeAmountModal() {
    closeModal(amountModal, { onComplete: clearAmountTheme });
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
