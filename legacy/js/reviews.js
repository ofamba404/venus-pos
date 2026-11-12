import { sbFetch } from './api.js';
import { getPageHref } from './config.js';
import { notifyStoreReview } from './notifications.js';
import { getRealtimeClient } from './realtime-client.js';
import { escapeHtml, showConfirm, showToast } from './utils.js';

const TABS = [
  { id: 'pending', label: 'Pending', empty: 'No reviews waiting.' },
  { id: 'approved', label: 'Approved', empty: 'No approved reviews yet.' },
  { id: 'hidden', label: 'Hidden', empty: 'Nothing hidden.' },
];

/** Same cap as the storefront review form and the store_reviews check. */
export const DISPLAY_NAME_MAX = 40;

const STATUS_LABEL = {
  pending: 'Pending',
  approved: 'Approved',
  hidden: 'Hidden',
};

/** @type {Array<{ id: string, created_at: string, rating: number, body: string, customer_name?: string | null, display_name?: string | null, status?: string | null, page_path?: string | null }>} */
let reviews = [];
let loading = false;
let loadError = '';
let reviewTab = 'pending';
let legacySchema = false;
let loadSeq = 0;
/** Tab whose rows are currently in `reviews`. */
let loadedFor = '';
/** @type {Record<string, number | null>} */
let counts = { pending: null, approved: null, hidden: null };
/** @type {Set<string>} */
const notifiedReviewIds = new Set();
/** @type {{ unsubscribe?: () => void } | null} */
let reviewsRealtimeChannel = null;
/** Review whose display name is being edited inline. */
let editingNameId = '';
let editingNameDraft = '';
let savingName = false;

function isOwner() {
  return window.VenusPosAuth?.isAdmin?.() === true;
}

/** Trim + collapse spaces; '' when empty. Mirrors the database guard. */
export function normalizeDisplayName(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function reviewName(row) {
  return String(row?.display_name || row?.customer_name || '').trim() || 'Guest';
}

function announceReview(row) {
  if (!row?.id || notifiedReviewIds.has(row.id)) return;
  notifiedReviewIds.add(row.id);
  void notifyStoreReview({
    reviewId: row.id,
    customerName: reviewName(row),
    rating: row.rating,
    body: row.body,
    url: getPageHref('reviews'),
  });
}

function starsHtml(rating) {
  const n = Math.max(0, Math.min(5, Number(rating) || 0));
  let out = '';
  for (let i = 1; i <= 5; i += 1) {
    out += `<span class="reviews-star${i <= n ? ' is-on' : ''}" aria-hidden="true">★</span>`;
  }
  return `<span class="reviews-stars" aria-label="${n} out of 5 stars">${out}</span>`;
}

function relativeTime(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 14) return `${day}d ago`;
  return new Date(t).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function averageRating(rows) {
  if (!rows.length) return null;
  const sum = rows.reduce((acc, r) => acc + (Number(r.rating) || 0), 0);
  return Math.round((sum / rows.length) * 10) / 10;
}

function countFromResponse(res, rangeHeader) {
  const total = Number(String(rangeHeader || '').split('/')[1]);
  if (!Number.isFinite(total)) return null;
  if (res.ok || res.status === 416) return total;
  return null;
}

async function loadCounts(seq) {
  if (legacySchema) return;
  const next = {};
  await Promise.all(
    TABS.map(async (tab) => {
      const res = await sbFetch(`store_reviews?select=id&status=eq.${tab.id}`, {
        headers: { Prefer: 'count=exact', Range: '0-0' },
      });
      const range = res.headers.get('content-range');
      await res.text().catch(() => '');
      next[tab.id] = countFromResponse(res, range);
    }),
  );
  if (seq !== loadSeq || legacySchema) return;
  counts = { ...counts, ...next };
  renderReviews();
}

function heroCopy() {
  if (legacySchema) return 'Run the store reviews migration in Supabase to approve or hide.';
  if (isOwner()) return 'Approve publishes a note on the shop. Hide takes it down.';
  return 'Read only. The owner approves or hides reviews.';
}

function tabsHtml() {
  if (legacySchema) return '';
  return `<div class="reviews-tabs" role="tablist" aria-label="Review status">
    ${TABS.map((tab) => {
      const selected = reviewTab === tab.id;
      const count = counts[tab.id];
      const countHtml =
        count == null ? '' : `<span class="reviews-tab__count">${count}</span>`;
      return `<button type="button" class="reviews-tab${selected ? ' is-active' : ''}" role="tab" aria-selected="${selected}" data-review-tab="${tab.id}">${tab.label}${countHtml}</button>`;
    }).join('')}
  </div>`;
}

function statusChip(status) {
  const label = STATUS_LABEL[status];
  if (!label) return '';
  return `<span class="reviews-card__status reviews-card__status--${status}">${label}</span>`;
}

function actionsHtml(row) {
  if (!isOwner() || legacySchema || !row?.id) return '';
  const status = String(row.status || '');
  const id = escapeHtml(row.id);
  const approve =
    status === 'approved'
      ? ''
      : `<button type="button" class="reviews-action is-approve" data-review-action="approved" data-review-id="${id}">Approve</button>`;
  const hide =
    status === 'hidden'
      ? ''
      : `<button type="button" class="reviews-action is-hide" data-review-action="hidden" data-review-id="${id}">Hide</button>`;
  const del = `<button type="button" class="reviews-action is-delete" data-review-delete="${id}">Delete</button>`;
  return `<div class="reviews-card__actions">${approve}${hide}${del}</div>`;
}

function nameHtml(row) {
  const name = reviewName(row);
  if (!isOwner() || legacySchema || !row?.id) {
    return `<span class="reviews-card__name">${escapeHtml(name)}</span>`;
  }
  const id = escapeHtml(row.id);
  if (editingNameId === row.id) {
    return `<form class="reviews-name-edit" data-review-name-form="${id}">
      <input class="reviews-name-edit__input" type="text" name="display_name" maxlength="${DISPLAY_NAME_MAX}" value="${escapeHtml(editingNameDraft)}" aria-label="Display name" autocomplete="off" ${savingName ? 'disabled' : ''} />
      <button type="submit" class="reviews-action is-approve" ${savingName ? 'disabled' : ''}>${savingName ? 'Saving…' : 'Save'}</button>
      <button type="button" class="reviews-action" data-review-name-cancel ${savingName ? 'disabled' : ''}>Cancel</button>
    </form>`;
  }
  return `<button type="button" class="reviews-card__name is-editable" data-review-rename="${id}" title="Edit display name" aria-label="Edit display name: ${escapeHtml(name)}">${escapeHtml(name)}<span class="reviews-card__name-edit" aria-hidden="true">✎</span></button>`;
}

export function renderReviews() {
  const hero = document.getElementById('reviewsHero');
  const list = document.getElementById('reviewsList');
  if (!hero || !list) return;

  const avg = averageRating(reviews);
  const count = reviews.length;
  const stats =
    count > 0
      ? `<div class="reviews-hero__stats">${avg != null ? `<strong>${avg}</strong> avg · ` : ''}${count} in this list</div>`
      : '';

  hero.innerHTML = `
    <div class="reviews-hero__row">
      <div>
        <h2 class="reviews-hero__title">Reviews</h2>
        <p class="reviews-hero__meta">${heroCopy()}</p>
        ${stats}
      </div>
      <button type="button" class="reviews-refresh" id="reviewsRefreshBtn">Refresh</button>
    </div>
    ${tabsHtml()}
  `;

  if (loading && !reviews.length) {
    list.innerHTML = `<div class="reviews-empty">Loading reviews…</div>`;
    return;
  }

  if (loadError && !reviews.length) {
    list.innerHTML = `<div class="reviews-empty is-error">${escapeHtml(loadError)}</div>`;
    return;
  }

  if (!reviews.length) {
    const tab = TABS.find((item) => item.id === reviewTab);
    const empty = legacySchema ? 'No reviews yet.' : tab?.empty || 'No reviews yet.';
    list.innerHTML = `<div class="reviews-empty">${empty}</div>`;
    return;
  }

  list.innerHTML = reviews
    .map((row) => {
      const body = String(row.body || '').trim();
      const when = relativeTime(row.created_at);
      const path = String(row.page_path || '').trim();
      const pathHtml = path && path !== '/' ? `<span class="reviews-card__path">${escapeHtml(path)}</span>` : '';
      return `
        <article class="reviews-card">
          <div class="reviews-card__top">
            ${starsHtml(row.rating)}
            <div class="reviews-card__meta">
              ${statusChip(String(row.status || ''))}
              <span class="reviews-card__when">${escapeHtml(when)}</span>
            </div>
          </div>
          <p class="reviews-card__body">${escapeHtml(body)}</p>
          <div class="reviews-card__foot">
            ${nameHtml(row)}
            ${pathHtml}
          </div>
          ${actionsHtml(row)}
        </article>
      `;
    })
    .join('');
}

function focusNameInput() {
  const input = document.querySelector('.reviews-name-edit__input');
  if (!input) return;
  input.focus();
  const end = input.value.length;
  try {
    input.setSelectionRange(end, end);
  } catch {
    /* ignore */
  }
}

function startNameEdit(id) {
  const row = reviews.find((item) => item.id === id);
  if (!row || !isOwner()) return;
  editingNameId = id;
  editingNameDraft = reviewName(row) === 'Guest' ? '' : reviewName(row);
  savingName = false;
  renderReviews();
  focusNameInput();
}

function cancelNameEdit() {
  editingNameId = '';
  editingNameDraft = '';
  savingName = false;
  renderReviews();
}

async function saveDisplayName(id, raw) {
  if (!isOwner()) {
    showToast('Only the owner can edit reviews', true);
    return;
  }
  const name = normalizeDisplayName(raw);
  if (!name) {
    showToast('Display name can’t be empty', true);
    focusNameInput();
    return;
  }
  if (name.length > DISPLAY_NAME_MAX) {
    showToast(`Keep it to ${DISPLAY_NAME_MAX} characters or fewer`, true);
    focusNameInput();
    return;
  }
  const row = reviews.find((item) => item.id === id);
  if (row && normalizeDisplayName(row.display_name) === name) {
    cancelNameEdit();
    return;
  }
  editingNameDraft = name;
  savingName = true;
  renderReviews();
  try {
    const res = await sbFetch(`store_reviews?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ display_name: name }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text || `Supabase ${res.status}`);
    let rows = [];
    try {
      rows = text ? JSON.parse(text) : [];
    } catch {
      rows = [];
    }
    if (!Array.isArray(rows) || !rows.length) throw new Error('Only the owner can edit reviews');
    reviews = reviews.map((item) => (item.id === id ? { ...item, ...rows[0] } : item));
    editingNameId = '';
    editingNameDraft = '';
    savingName = false;
    renderReviews();
    showToast('Name updated');
  } catch (err) {
    console.error('rename review failed', err);
    savingName = false;
    renderReviews();
    focusNameInput();
    showToast('Could not save that name', true);
  }
}

async function deleteReview(id, button) {
  if (!isOwner()) {
    showToast('Only the owner can delete reviews', true);
    return;
  }
  const row = reviews.find((item) => item.id === id);
  if (!row) return;
  const ok = await showConfirm(
    `Delete this review from ${reviewName(row)}?\n\nIt will be removed from the shop and the POS. This can’t be undone.`,
    { okLabel: 'Delete', multiline: true },
  );
  if (!ok) return;
  if (button) {
    button.disabled = true;
    button.textContent = 'Deleting…';
  }
  try {
    const res = await sbFetch(`store_reviews?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text || `Supabase ${res.status}`);
    let rows = [];
    try {
      rows = text ? JSON.parse(text) : [];
    } catch {
      rows = [];
    }
    if (!Array.isArray(rows) || !rows.length) throw new Error('Only the owner can delete reviews');
    reviews = reviews.filter((item) => item.id !== id);
    if (editingNameId === id) editingNameId = '';
    renderReviews();
    showToast('Review deleted');
    if (!legacySchema) void loadCounts(loadSeq);
  } catch (err) {
    console.error('delete review failed', err);
    showToast('Could not delete that review', true);
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = 'Delete';
    }
  }
}

function applyRealtimeDelete(oldRow) {
  if (!oldRow?.id || !document.getElementById('reviewsList')) return;
  if (!reviews.some((item) => item.id === oldRow.id)) return;
  reviews = reviews.filter((item) => item.id !== oldRow.id);
  if (editingNameId === oldRow.id) editingNameId = '';
  renderReviews();
  if (!legacySchema) void loadCounts(loadSeq);
}

function applyRealtimeRow(row) {
  if (!row?.id || !document.getElementById('reviewsList')) return;
  const status = row.status || 'pending';
  if (legacySchema || status === reviewTab) {
    reviews = [row, ...reviews.filter((item) => item.id !== row.id)].slice(0, 100);
  } else {
    reviews = reviews.filter((item) => item.id !== row.id);
  }
  renderReviews();
  if (!legacySchema) void loadCounts(loadSeq);
}

async function moderateReview(id, status) {
  if (!isOwner()) {
    showToast('Only the owner can moderate reviews', true);
    return;
  }
  if (!id || (status !== 'approved' && status !== 'hidden')) return;
  const res = await sbFetch(`store_reviews?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Supabase ${res.status}`);
  let rows = [];
  try {
    rows = text ? JSON.parse(text) : [];
  } catch {
    rows = [];
  }
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error('Only the owner can moderate reviews');
  }
  showToast(status === 'approved' ? 'Approved' : 'Hidden');
  await loadReviews();
}

export async function loadReviews() {
  const seq = ++loadSeq;
  const tab = reviewTab;
  if (loadedFor !== tab) reviews = [];
  loading = true;
  loadError = '';
  renderReviews();
  try {
    const filtered = `store_reviews?select=id,created_at,rating,body,display_name,customer_name,status,page_path&status=eq.${encodeURIComponent(tab)}&order=created_at.desc&limit=100`;
    let res = await sbFetch(filtered);
    if (seq !== loadSeq) return;
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      if (/display_name|status|42703|PGRST204/i.test(detail)) {
        legacySchema = true;
        res = await sbFetch(
          'store_reviews?select=id,created_at,rating,body,customer_name&order=created_at.desc&limit=100',
        );
        if (seq !== loadSeq) return;
        if (!res.ok) throw new Error(`Supabase ${res.status}`);
      } else {
        throw new Error(detail || `Supabase ${res.status}`);
      }
    } else {
      legacySchema = false;
    }
    const rows = await res.json();
    if (seq !== loadSeq) return;
    reviews = Array.isArray(rows) ? rows : [];
    loadedFor = tab;
    if (!legacySchema) void loadCounts(seq);
  } catch (err) {
    if (seq !== loadSeq) return;
    console.error('load reviews failed', err);
    loadError = 'Could not load reviews — check connection.';
    if (!reviews.length) showToast('Could not load reviews', true);
  } finally {
    if (seq !== loadSeq) return;
    loading = false;
    renderReviews();
  }
}

export function wireReviewsPage() {
  const root = document.getElementById('app-root');
  if (!root || root.dataset.reviewsWired === '1') return;
  root.dataset.reviewsWired = '1';
  root.addEventListener('click', (event) => {
    const tabBtn = event.target?.closest?.('[data-review-tab]');
    if (tabBtn) {
      const next = tabBtn.getAttribute('data-review-tab') || 'pending';
      if (!TABS.some((tab) => tab.id === next) || next === reviewTab) return;
      reviewTab = next;
      editingNameId = '';
      void loadReviews();
      return;
    }
    const renameBtn = event.target?.closest?.('[data-review-rename]');
    if (renameBtn) {
      startNameEdit(renameBtn.getAttribute('data-review-rename'));
      return;
    }
    if (event.target?.closest?.('[data-review-name-cancel]')) {
      cancelNameEdit();
      return;
    }
    const delBtn = event.target?.closest?.('[data-review-delete]');
    if (delBtn) {
      void deleteReview(delBtn.getAttribute('data-review-delete'), delBtn);
      return;
    }
    const action = event.target?.closest?.('[data-review-action]');
    if (action) {
      const id = action.getAttribute('data-review-id');
      const status = action.getAttribute('data-review-action');
      action.disabled = true;
      action.textContent = status === 'approved' ? 'Approving…' : 'Hiding…';
      void moderateReview(id, status).catch((err) => {
        console.error('moderate review failed', err);
        showToast('Could not update that review', true);
        action.disabled = false;
        action.textContent = status === 'approved' ? 'Approve' : 'Hide';
      });
      return;
    }
    const btn = event.target?.closest?.('#reviewsRefreshBtn');
    if (!btn) return;
    void loadReviews();
  });
  root.addEventListener('submit', (event) => {
    const form = event.target?.closest?.('[data-review-name-form]');
    if (!form) return;
    event.preventDefault();
    const id = form.getAttribute('data-review-name-form');
    const input = form.querySelector('input[name="display_name"]');
    void saveDisplayName(id, input?.value);
  });
  root.addEventListener('input', (event) => {
    if (event.target?.matches?.('.reviews-name-edit__input')) editingNameDraft = event.target.value;
  });
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && event.target?.matches?.('.reviews-name-edit__input')) {
      event.preventDefault();
      cancelNameEdit();
    }
  });
}

async function startReviewsRealtime() {
  if (reviewsRealtimeChannel) return true;
  try {
    const client = await getRealtimeClient();
    const channel = client
      .channel('pos-store-reviews')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'store_reviews' },
        (payload) => {
          const row = payload?.new;
          applyRealtimeRow(row);
          announceReview(row);
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'store_reviews' },
        (payload) => {
          applyRealtimeRow(payload?.new);
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'store_reviews' },
        (payload) => {
          applyRealtimeDelete(payload?.old);
        },
      );

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('reviews realtime timeout')), 8000);
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timeout);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timeout);
          reject(new Error(`reviews realtime ${status}`));
        }
      });
    });

    reviewsRealtimeChannel = channel;
    return true;
  } catch (err) {
    console.warn('store reviews realtime unavailable', err);
    reviewsRealtimeChannel = null;
    return false;
  }
}

/** Open-tab review alerts (Web Push covers closed browser from the storefront). */
export function startReviewsRuntime() {
  void startReviewsRealtime();
}
