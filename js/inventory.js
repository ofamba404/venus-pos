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
import {
  inventory,
  draftStock,
  isInventoryHydrated,
  markInventoryHydrated,
  isInventoryNetworkSynced,
  markInventoryNetworkSynced,
} from './state.js';
import { notifyStockCrossing } from './notifications.js';
import { showToast } from './utils.js';
import { showPlaceholder, revealLoaded, jointsStatusPlaceholder, cookieFlavorPlaceholder } from './pending.js';

const HIGHLIGHT_KEY = 'venus-pos-stock-highlight';
const KNOWN_IDS = new Set(CATEGORIES.map((c) => c.id));

/** In-flight writes per category — serialized so rapid taps don't race. */
const writeQueue = new Map();

export {
  isInventoryHydrated,
  markInventoryHydrated,
  isInventoryNetworkSynced,
  markInventoryNetworkSynced,
};

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

function clampStock(n) {
  return Math.max(0, Math.floor(Number(n) || 0));
}

function assertWritableId(id) {
  if (!KNOWN_IDS.has(id)) {
    throw new Error(`Unknown inventory category: ${id}`);
  }
}

function setLocalStock(id, stock) {
  const next = clampStock(stock);
  inventory[id] = next;
  draftStock[id] = next;
  return next;
}

async function staffAccessToken() {
  const token =
    window.VenusPosAuth?.peekAccessToken?.() ||
    (await window.VenusPosAuth?.getAccessToken?.().catch(() => '')) ||
    '';
  if (!token) throw new Error('Not signed in');
  return token;
}

/**
 * ONE write path: Netlify function + service role.
 * Client never PATCHes Supabase inventory directly — that caused RLS ghosts,
 * false toasts, zero-wipes, and butterscotch migration bugs.
 */
async function apiWriteStock({ categoryId, op, stock, delta }) {
  assertWritableId(categoryId);
  const token = await staffAccessToken();
  const res = await fetch('/api/inventory/write', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      category_id: categoryId,
      op,
      ...(op === 'set' ? { stock: clampStock(stock) } : { delta: Math.trunc(Number(delta) || 0) }),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `Inventory write failed (${res.status})`);
  }
  return setLocalStock(categoryId, data.stock);
}

/** Checkout / sale edits: deduct/add against live server stock. */
export async function applyStockDeltaToServer(id, delta) {
  assertWritableId(id);
  if (!isInventoryHydrated()) {
    throw new Error('Inventory not loaded yet');
  }
  const d = Math.trunc(Number(delta) || 0);
  if (d === 0) return inventory[id];
  return apiWriteStock({ categoryId: id, op: 'delta', delta: d });
}

/** User typed an absolute count. */
export async function setStockAbsoluteOnServer(id, stock) {
  assertWritableId(id);
  if (!isInventoryHydrated()) {
    throw new Error('Inventory not loaded yet');
  }
  return apiWriteStock({ categoryId: id, op: 'set', stock });
}

/** @deprecated */
export async function upsertInventoryStock(id) {
  return setStockAbsoluteOnServer(id, inventory[id]);
}

function enqueueWrite(id, work) {
  const prev = writeQueue.get(id) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(work)
    .catch((e) => {
      console.error('persist stock failed', e);
      // Only toast after the authoritative API rejects — not after local cache quirks.
      showToast('Could not save stock — try again', true);
    });
  writeQueue.set(id, next);
  return next;
}

export async function persistStock(id) {
  return enqueueWrite(id, async () => {
    await setStockAbsoluteOnServer(id, inventory[id]);
    try {
      await dataStore.persistCurrent('inventory');
    } catch (e) {
      console.warn('local inventory cache persist failed', e);
    }
  });
}

export async function persistStockDelta(id, delta, rollbackTo) {
  const prior = rollbackTo != null ? clampStock(rollbackTo) : null;
  return enqueueWrite(id, async () => {
    try {
      await applyStockDeltaToServer(id, delta);
    } catch (e) {
      if (prior != null) {
        setLocalStock(id, prior);
        refreshInvCard(id);
        renderStockGlance();
      }
      throw e;
    }
    refreshInvCard(id);
    renderStockGlance();
    try {
      await dataStore.persistCurrent('inventory');
    } catch (e) {
      console.warn('local inventory cache persist failed', e);
    }
  });
}

export function refreshInvCard(id) {
  const el = document.getElementById(`inv-count-${id}`);
  if (!el) return;
  el.textContent = inventory[id];
  bumpElement(el);
}

export function adjustStock(id, delta) {
  assertWritableId(id);
  if (!isInventoryHydrated()) {
    showToast('Stock still loading — try again in a moment', true);
    return;
  }
  const previous = inventory[id];
  // Optimistic UI — server confirms via /api/inventory/write.
  setLocalStock(id, previous + delta);
  refreshInvCard(id);
  void persistStockDelta(id, delta, previous);
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
    if (!isInventoryHydrated()) {
      if (el) el.textContent = fallback;
      showToast('Stock still loading — try again in a moment', true);
      return;
    }
    assertWritableId(id);
    const previous = inventory[id];
    setLocalStock(id, num);
    if (el) el.textContent = inventory[id];
    void persistStock(id);
    renderStockGlance();
    if (inventory[id] < previous) void notifyStockCrossing(id, previous, inventory[id]);
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
  if (Array.isArray(rows) && rows.length > 0) markInventoryHydrated();
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
  await ensureInventoryRows();
  await dataStore.fetch('inventory');
  markInventoryNetworkSynced(true);
  syncInventoryToDom();
  renderStockGlance();
}

function isCookieCategory(cat) {
  return isCookieCategoryId(cat?.id);
}

/**
 * Create missing CATEGORIES inventory rows at stock 0, and apply live server
 * values into local state before any writes are allowed.
 *
 * NEVER migrates, mirrors, redistributes, or mutates existing stock.
 */
export async function ensureInventoryRows() {
  try {
    const res = await sbFetch('inventory?select=category_id,stock');
    if (!res.ok) return;
    const rows = await res.json();
    if (!Array.isArray(rows)) return;

    const byId = Object.fromEntries(
      rows.map((r) => [r.category_id, clampStock(r.stock)]),
    );

    // Always adopt server values for known categories before marking ready.
    let applied = 0;
    CATEGORIES.forEach((cat) => {
      if (!Object.hasOwn(byId, cat.id)) return;
      setLocalStock(cat.id, byId[cat.id]);
      const el = document.getElementById(`inv-count-${cat.id}`);
      if (el && !el.querySelector('input')) el.textContent = inventory[cat.id];
      applied += 1;
    });
    if (applied > 0) markInventoryNetworkSynced(true);

    const now = new Date().toISOString();
    const missing = CATEGORIES.filter((cat) => !Object.hasOwn(byId, cat.id)).map((cat) => ({
      category_id: cat.id,
      stock: 0,
      updated_at: now,
    }));

    if (!missing.length) return;

    const post = await sbFetch('inventory', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(missing),
    });
    if (!post.ok) {
      console.warn('ensureInventoryRows insert failed', post.status);
      return;
    }
    missing.forEach((row) => {
      if (!Object.hasOwn(inventory, row.category_id)) return;
      setLocalStock(row.category_id, 0);
    });
  } catch (e) {
    console.warn('ensureInventoryRows', e);
  }
}

/** @deprecated Use ensureInventoryRows — no migration side effects. */
export async function ensureInventoryCategories() {
  return ensureInventoryRows();
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

function stockState(qty) {
  if (qty <= 0) return 'out';
  if (qty < LOW_STOCK_THRESHOLD) return 'low';
  return 'ok';
}

/** Cookie fill = stock / 100 capacity; kept for callers that need aggregate level. */
export function cookieStockLevel(stock) {
  const pct = stock <= 0 ? 0 : Math.min(100, Math.round((stock / COOKIE_STOCK_CAPACITY) * 100));
  if (stock === 0) return { pct, state: 'out' };
  const lowCutoff = Math.max(LOW_STOCK_THRESHOLD, Math.round(COOKIE_STOCK_CAPACITY * COOKIE_LOW_PCT));
  if (stock < lowCutoff) return { pct, state: 'low' };
  return { pct, state: 'ok' };
}

function renderJointsPills({ ok, low, out }) {
  return `
    <button type="button" class="sg-pill sg-ok" data-status="ok" aria-label="${ok} well stocked">
      <span class="sg-pill-n">${ok}</span><span class="sg-pill-l">ok</span>
    </button>
    <button type="button" class="sg-pill sg-low" data-status="low" aria-label="${low} running low">
      <span class="sg-pill-n">${low}</span><span class="sg-pill-l">low</span>
    </button>
    <button type="button" class="sg-pill sg-out" data-status="out" aria-label="${out} out of stock">
      <span class="sg-pill-n">${out}</span><span class="sg-pill-l">out</span>
    </button>`;
}

function renderCookieFlavorRows(cookieCats) {
  return cookieCats
    .map((c) => {
      const qty = inventory[c.id] || 0;
      const state = stockState(qty);
      return `
        <div class="sg-cookie-row" data-state="${state}">
          <span class="sg-cookie-swatch" style="background:${c.color}"></span>
          <span class="sg-cookie-name">${c.name}</span>
          <span class="sg-cookie-qty">${qty}</span>
        </div>`;
    })
    .join('');
}

export function renderStockGlance() {
  const donutJoints = document.getElementById('donutJoints');
  const donutJointsTotal = document.getElementById('donutJointsTotal');
  const jointsStatus = document.getElementById('jointsStatus');
  const cookieFlavorGlance = document.getElementById('cookieFlavorGlance');
  if (!donutJoints) return;

  const jointCats = CATEGORIES.filter((c) => !isCookieCategory(c));
  const cookieCats = CATEGORIES.filter(isCookieCategory);

  const jointsTotal = jointCats.reduce((sum, c) => sum + inventory[c.id], 0);
  const stockPending = showPlaceholder('inventory');

  if (donutJointsTotal) {
    donutJointsTotal.classList.toggle('is-pending', stockPending);
    donutJointsTotal.textContent = stockPending ? '—' : String(jointsTotal);
  }
  donutJoints.style.background = stockPending ? 'var(--btn-bg)' : buildDonutGradient(jointCats, jointsTotal);

  if (jointsStatus) {
    jointsStatus.innerHTML = stockPending
      ? jointsStatusPlaceholder()
      : renderJointsPills(countByStatus(jointCats));
    jointsStatus.querySelectorAll('.sg-pill').forEach((chip) => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const status = chip.dataset.status || 'ok';
        setActiveStatusHighlight(status);
        void navigate('analytics', { hash: '#stock' });
      });
    });
  }

  if (cookieFlavorGlance) {
    cookieFlavorGlance.innerHTML = stockPending
      ? cookieFlavorPlaceholder(cookieCats)
      : renderCookieFlavorRows(cookieCats);
  }
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
