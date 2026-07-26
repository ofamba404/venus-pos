import { sbFetch } from './api.js';
import { getPageHref } from './config.js';
import { notifyStoreReview } from './notifications.js';
import { getRealtimeClient } from './realtime-client.js';
import { escapeHtml, showToast } from './utils.js';

/** @type {Array<{ id: string, created_at: string, rating: number, body: string, customer_name?: string | null, page_path?: string | null }>} */
let reviews = [];
let loading = false;
let loadError = '';
/** @type {Set<string>} */
const notifiedReviewIds = new Set();
/** @type {{ unsubscribe?: () => void } | null} */
let reviewsRealtimeChannel = null;

function announceReview(row) {
  if (!row?.id || notifiedReviewIds.has(row.id)) return;
  notifiedReviewIds.add(row.id);
  void notifyStoreReview({
    reviewId: row.id,
    customerName: row.customer_name,
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

export function renderReviews() {
  const hero = document.getElementById('reviewsHero');
  const list = document.getElementById('reviewsList');
  if (!hero || !list) return;

  const avg = averageRating(reviews);
  const count = reviews.length;
  hero.innerHTML = `
    <div class="reviews-hero__row">
      <div>
        <div class="reviews-hero__title">Reviews</div>
        <div class="reviews-hero__meta">
          ${
            count
              ? `${avg != null ? `<strong>${avg}</strong> avg · ` : ''}${count} review${count === 1 ? '' : 's'}`
              : loading
                ? 'Loading…'
                : 'Storefront feedback'
          }
        </div>
      </div>
      <button type="button" class="modal-btn confirm reviews-refresh" id="reviewsRefreshBtn">Refresh</button>
    </div>
  `;

  if (loading && !reviews.length) {
    list.innerHTML = `<div class="reviews-empty">Loading reviews…</div>`;
    return;
  }

  if (loadError && !reviews.length) {
    list.innerHTML = `<div class="reviews-empty">${escapeHtml(loadError)}</div>`;
    return;
  }

  if (!reviews.length) {
    list.innerHTML = `<div class="reviews-empty">No reviews yet.</div>`;
    return;
  }

  list.innerHTML = reviews
    .map((row) => {
      const name = String(row.customer_name || '').trim() || 'Guest';
      const body = String(row.body || '').trim();
      const when = relativeTime(row.created_at);
      const path = String(row.page_path || '').trim();
      return `
        <article class="reviews-card">
          <div class="reviews-card__top">
            ${starsHtml(row.rating)}
            <span class="reviews-card__when">${escapeHtml(when)}</span>
          </div>
          <p class="reviews-card__body">${escapeHtml(body)}</p>
          <div class="reviews-card__foot">
            <span class="reviews-card__name">${escapeHtml(name)}</span>
            ${path ? `<span class="reviews-card__path">${escapeHtml(path)}</span>` : ''}
          </div>
        </article>
      `;
    })
    .join('');
}

export async function loadReviews() {
  if (loading) return;
  loading = true;
  loadError = '';
  renderReviews();
  try {
    const res = await sbFetch(
      'store_reviews?select=id,created_at,rating,body,customer_name,page_path&order=created_at.desc&limit=100',
    );
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    const rows = await res.json();
    reviews = Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.error('load reviews failed', err);
    loadError = 'Could not load reviews — check connection.';
    if (!reviews.length) showToast('Could not load reviews', true);
  } finally {
    loading = false;
    renderReviews();
  }
}

export function wireReviewsPage() {
  document.getElementById('app-root')?.addEventListener('click', (event) => {
    const btn = event.target?.closest?.('#reviewsRefreshBtn');
    if (!btn) return;
    void loadReviews();
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
          if (!row?.id) return;
          // Keep inbox fresh if staff are already on the reviews page.
          if (document.getElementById('reviewsList')) {
            reviews = [row, ...reviews.filter((r) => r.id !== row.id)].slice(0, 100);
            renderReviews();
          }
          announceReview(row);
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
