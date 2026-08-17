import { dataStore } from './store/index.js';
import { bumpElement, closeModal, openModal } from './animations.js';
import { sbFetch } from './api.js';
import {
  CATEGORIES,
  CAT_MAP,
  COOKIE_LOW_PCT,
  COOKIE_STOCK_CAPACITY,
  LOW_STOCK_THRESHOLD,
  canonicalInventoryCategoryId,
  isCookieCategoryId,
  normalizeInventoryBreakdown,
} from './config.js';
import { navigate } from './router.js';
import {
  inventory,
  draftStock,
  isInventoryHydrated,
  markInventoryHydrated,
  isInventoryNetworkSynced,
  markInventoryNetworkSynced,
  isInventoryReady,
  markInventoryReady,
} from './state.js';
import { notifyStockCrossing } from './notifications.js';
import { showToast } from './utils.js';
import { showPlaceholder, revealLoaded, jointsStatusPlaceholder, cookieFlavorPlaceholder } from './pending.js';

const HIGHLIGHT_KEY = 'venus-pos-stock-highlight';
const KNOWN_IDS = new Set(CATEGORIES.map((c) => c.id));

/** In-flight writes per category — serialized so rapid taps don't race. */
const writeQueue = new Map();

/** Deduplicate concurrent boot / self-heal loads. */
let loadPromise = null;

export {
  isInventoryHydrated,
  markInventoryHydrated,
  isInventoryNetworkSynced,
  markInventoryNetworkSynced,
  isInventoryReady,
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
  const canon = canonicalInventoryCategoryId(id);
  if (!KNOWN_IDS.has(canon)) {
    throw new Error(`Unknown inventory category: ${id}`);
  }
  return canon;
}

function setLocalStock(id, stock) {
  const next = clampStock(stock);
  inventory[id] = next;
  draftStock[id] = next;
  return next;
}

/**
 * Apply a full server snapshot (including zeros) and unlock inventory.
 * @returns {number} known categories updated
 */
function applyServerRows(rows) {
  let applied = 0;
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row?.category_id) return;
    const canon = canonicalInventoryCategoryId(row.category_id);
    // Ignore leftover shared `cookie` — ensure absorbs it server-side.
    if (canon !== row.category_id) return;
    if (!Object.hasOwn(inventory, canon)) return;
    setLocalStock(canon, row.stock);
    const el = document.getElementById(`inv-count-${canon}`);
    if (el && !el.querySelector('input')) el.textContent = inventory[canon];
    applied += 1;
  });
  if (applied > 0) markInventoryReady();
  return applied;
}

async function staffAccessToken() {
  const token =
    (await window.VenusPosAuth?.getAccessToken?.().catch(() => '')) ||
    window.VenusPosAuth?.peekAccessToken?.() ||
    '';
  if (!token) throw new Error('Not signed in');
  return token;
}

/**
 * ONE network path for POS inventory: Netlify function + service role.
 * Falls back to direct staff JWT writes if the function route misbehaves (405).
 */
async function apiInventory(body) {
  const token = await staffAccessToken();
  const res = await fetch('/api/inventory/write', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) {
    const detail = data?.error || res.statusText || `HTTP ${res.status}`;
    const err = new Error(detail);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

/** Direct Supabase write with the signed-in staff JWT (RLS). Used only as fallback. */
async function clientUpsertStock(categoryId, stock) {
  const id = assertWritableId(categoryId);
  const next = clampStock(stock);
  const payload = { stock: next, updated_at: new Date().toISOString() };
  const patch = await sbFetch(`inventory?category_id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  });
  if (patch.ok) {
    const rows = await patch.json().catch(() => []);
    if (Array.isArray(rows) && rows[0]) {
      return setLocalStock(id, rows[0].stock);
    }
  }

  const ins = await sbFetch('inventory', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ category_id: id, ...payload }),
  });
  if (!ins.ok) {
    throw new Error(`Direct stock write failed (${ins.status})`);
  }
  const inserted = await ins.json().catch(() => []);
  if (Array.isArray(inserted) && inserted[0]) {
    return setLocalStock(id, inserted[0].stock);
  }
  return setLocalStock(id, next);
}

async function clientApplyDelta(categoryId, delta) {
  const id = assertWritableId(categoryId);
  const d = Math.trunc(Number(delta) || 0);
  if (d === 0) return inventory[id];
  const read = await sbFetch(
    `inventory?category_id=eq.${encodeURIComponent(id)}&select=category_id,stock`,
  );
  if (!read.ok) throw new Error(`Direct stock read failed (${read.status})`);
  const rows = await read.json().catch(() => []);
  const current = Array.isArray(rows) && rows[0] ? clampStock(rows[0].stock) : 0;
  return clientUpsertStock(id, current + d);
}

async function apiWriteStock({ categoryId, op, stock, delta }) {
  const id = assertWritableId(categoryId);
  try {
    const data = await apiInventory({
      category_id: id,
      op,
      ...(op === 'set' ? { stock: clampStock(stock) } : { delta: Math.trunc(Number(delta) || 0) }),
    });
    return setLocalStock(id, data.stock);
  } catch (e) {
    // Function route / method quirks — keep the register usable.
    if (e?.status === 405 || e?.status === 404 || e?.status === 502 || e?.status === 503) {
      console.warn('inventory API unavailable, falling back to direct write', e?.message || e);
      if (op === 'set') return clientUpsertStock(id, stock);
      return clientApplyDelta(id, delta);
    }
    throw e;
  }
}

/**
 * Wait until inventory can be edited. Loads from the authoritative API if needed.
 * Does not toast-and-bail on first tap — one gesture loads then applies.
 */
export async function awaitInventoryReady() {
  if (isInventoryReady()) return true;
  const ok = await loadInventory();
  if (isInventoryReady()) return true;
  if (!ok) throw new Error('Inventory not loaded yet');
  return true;
}

/** Checkout / sale edits: deduct/add against live server stock. */
export async function applyStockDeltaToServer(id, delta) {
  const canon = assertWritableId(id);
  await awaitInventoryReady();
  const d = Math.trunc(Number(delta) || 0);
  if (d === 0) return inventory[canon];
  return apiWriteStock({ categoryId: canon, op: 'delta', delta: d });
}

/** User typed an absolute count. */
export async function setStockAbsoluteOnServer(id, stock) {
  const canon = assertWritableId(id);
  await awaitInventoryReady();
  return apiWriteStock({ categoryId: canon, op: 'set', stock });
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
      const msg =
        e?.status === 503 || /service role|not configured/i.test(String(e?.message || ''))
          ? 'Stock save blocked — missing SUPABASE_SERVICE_ROLE_KEY on Netlify'
          : e?.status === 401
            ? 'Session expired — sign in again'
            : e?.message
              ? `Could not save stock — ${e.message}`
              : 'Could not save stock — try again';
      showToast(msg, true);
      throw e;
    });
  writeQueue.set(id, next);
  return next;
}

export async function persistStock(id) {
  const canon = assertWritableId(id);
  return enqueueWrite(canon, async () => {
    await setStockAbsoluteOnServer(canon, inventory[canon]);
    try {
      await dataStore.persistCurrent('inventory');
    } catch (e) {
      console.warn('local inventory cache persist failed', e);
    }
  });
}

export async function persistStockDelta(id, delta, rollbackTo) {
  const canon = assertWritableId(id);
  const prior = rollbackTo != null ? clampStock(rollbackTo) : null;
  return enqueueWrite(canon, async () => {
    try {
      await applyStockDeltaToServer(canon, delta);
    } catch (e) {
      if (prior != null) {
        setLocalStock(canon, prior);
        refreshInvCard(canon);
        renderStockGlance();
      }
      throw e;
    }
    refreshInvCard(canon);
    renderStockGlance();
    try {
      await dataStore.persistCurrent('inventory');
    } catch (e) {
      console.warn('local inventory cache persist failed', e);
    }
  });
}

/** Checkout: deduct sold qty against live server stock (queued per flavor). */
export async function persistSoldBreakdown(soldById) {
  const entries = Object.entries(normalizeInventoryBreakdown(soldById)).filter(
    ([id, qty]) => KNOWN_IDS.has(id) && Number(qty) > 0,
  );
  await Promise.all(
    entries.map(([id, qty]) => persistStockDelta(id, -Number(qty), inventory[id] + Number(qty))),
  );
}

export function refreshInvCard(id) {
  const el = document.getElementById(`inv-count-${id}`);
  if (!el) return;
  el.textContent = inventory[id];
  bumpElement(el);
}

function applyLocalDelta(canon, d) {
  const previous = inventory[canon];
  if (d < 0 && previous <= 0) return null;
  setLocalStock(canon, previous + d);
  refreshInvCard(canon);
  renderStockGlance();
  if (d < 0) void notifyStockCrossing(canon, previous, inventory[canon]);
  void persistStockDelta(canon, d, previous).catch(() => {});
  return inventory[canon];
}

export function adjustStock(id, delta) {
  const canon = assertWritableId(id);
  const d = Math.trunc(Number(delta) || 0);
  if (d === 0) return;

  const run = async () => {
    try {
      await awaitInventoryReady();
    } catch (e) {
      console.error('inventory ready failed', e);
      const msg =
        e?.status === 503
          ? 'Inventory server not configured'
          : e?.status === 401
            ? 'Session expired — sign in again'
            : 'Could not load stock — check connection';
      showToast(msg, true);
      return;
    }
    applyLocalDelta(canon, d);
  };
  void run();
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
  if (isNaN(num) || num < 0) {
    if (el) el.textContent = fallback;
    return;
  }

  const run = async () => {
    try {
      await awaitInventoryReady();
    } catch (e) {
      if (el) el.textContent = fallback;
      showToast('Could not load stock — check connection', true);
      return;
    }
    const canon = assertWritableId(id);
    const previous = inventory[canon];
    if (num === previous) {
      if (el) el.textContent = previous;
      return;
    }
    setLocalStock(canon, num);
    if (el) el.textContent = inventory[canon];
    void persistStock(canon).catch(() => {});
    renderStockGlance();
    if (inventory[canon] < previous) void notifyStockCrossing(canon, previous, inventory[canon]);
  };
  void run();
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

/**
 * Authoritative inventory load for POS.
 * 1) /api/inventory/write ensure (service role) — preferred
 * 2) fallback direct Supabase fetch
 * 3) if IDB already hydrated categories, unlock writes anyway
 */
export async function loadInventory() {
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    let lastErr = null;
    try {
      const data = await apiInventory({ op: 'ensure' });
      if (Array.isArray(data.rows) && data.rows.length > 0) {
        applyServerRows(data.rows);
        try {
          await dataStore.persistCurrent('inventory');
        } catch (e) {
          console.warn('local inventory cache persist failed', e);
        }
        syncInventoryToDom();
        renderStockGlance();
        return true;
      }
    } catch (e) {
      lastErr = e;
      console.warn('ensureInventoryRows failed', e?.message || e);
    }

    try {
      const result = await dataStore.fetch('inventory', { force: true, silent: true });
      if (result?.ok) {
        markInventoryReady();
        syncInventoryToDom();
        renderStockGlance();
        return true;
      }
    } catch (e) {
      lastErr = e;
      console.warn('inventory fetch fallback failed', e);
    }

    // Offline / API down but IDB already painted known categories.
    if (isInventoryHydrated()) {
      markInventoryReady();
      syncInventoryToDom();
      renderStockGlance();
      return true;
    }

    if (lastErr) throw lastErr;
    return false;
  })().finally(() => {
    loadPromise = null;
  });

  return loadPromise;
}

function isCookieCategory(cat) {
  return isCookieCategoryId(cat?.id);
}

/**
 * Absorb leftover shared `cookie` stock into butterscotch and create any
 * missing flavor rows. Prefer loadInventory() — this remains for boot callers.
 */
export async function ensureInventoryRows() {
  return loadInventory();
}

/** @deprecated Use ensureInventoryRows / loadInventory. */
export async function ensureInventoryCategories() {
  return loadInventory();
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
