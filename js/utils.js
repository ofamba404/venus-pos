export function fmtUGX(n) {
  return `UGX ${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export function fmtCompact(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return Math.round(n).toString();
}

export function isSameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

export function isToday(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

import { animateToastIn, animateToastOut, closeModal, isModalOpen, openModal } from './animations.js';

const TOAST_ICON_OK = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>`;
const TOAST_ICON_ERR = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16h.01"/></svg>`;

export function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  if (!t) return;
  const icon = t.querySelector('.toast-icon');
  const text = t.querySelector('.toast-msg') || t;
  const tone = isError ? 'error' : 'success';

  t.hidden = false;
  t.dataset.tone = tone;
  t.classList.toggle('error', isError);
  t.setAttribute('aria-live', isError ? 'assertive' : 'polite');
  if (icon) icon.innerHTML = isError ? TOAST_ICON_ERR : TOAST_ICON_OK;
  text.textContent = msg;

  animateToastIn(t);
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => animateToastOut(t), isError ? 3200 : 2600);
}

let confirmResolve = null;

export function showConfirm(message) {
  const confirmOverlay = document.getElementById('confirmOverlay');
  const confirmMessageEl = document.getElementById('confirmMessage');
  if (!confirmOverlay || !confirmMessageEl) return Promise.resolve(false);
  confirmMessageEl.textContent = message;
  openModal(confirmOverlay);
  return new Promise((resolve) => {
    confirmResolve = resolve;
  });
}

export function resolveConfirm(result) {
  const confirmOverlay = document.getElementById('confirmOverlay');
  if (confirmOverlay) closeModal(confirmOverlay);
  if (confirmResolve) {
    confirmResolve(result);
    confirmResolve = null;
  }
}

export function wireConfirmDialog() {
  const confirmOverlay = document.getElementById('confirmOverlay');
  const confirmOkBtn = document.getElementById('confirmOkBtn');
  const confirmCancelBtn = document.getElementById('confirmCancelBtn');
  if (!confirmOverlay) return;

  confirmOkBtn?.addEventListener('click', () => resolveConfirm(true));
  confirmCancelBtn?.addEventListener('click', () => resolveConfirm(false));
  confirmOverlay.addEventListener('click', (e) => {
    if (e.target === confirmOverlay) resolveConfirm(false);
  });
}

export function openEditModal() {
  const overlay = document.getElementById('editOverlay');
  if (overlay) openModal(overlay);
}

export function closeEditModal() {
  const overlay = document.getElementById('editOverlay');
  if (overlay) closeModal(overlay);
}

export function wireEditOverlay() {
  const overlay = document.getElementById('editOverlay');
  if (!overlay) return;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeEditModal();
  });
}

export function setPageLoading(isLoading) {
  document.body.classList.toggle('is-loading', isLoading);
}

export function skeletonLines(count = 3, widths = ['wide', 'medium', 'short']) {
  return `<div class="data-skeleton" aria-hidden="true">${Array.from({ length: count }, (_, i) => `<div class="sk-line ${widths[i % widths.length]}"></div>`).join('')}</div>`;
}

export function skeletonRows(count = 4) {
  return `<div class="data-skeleton data-skeleton-rows" aria-hidden="true">${Array.from({ length: count }, () => '<div class="sk-row"><div class="sk-line wide"></div><div class="sk-line short"></div></div>').join('')}</div>`;
}

export function skeletonStatCards() {
  return `<div class="data-skeleton data-skeleton-stat" aria-hidden="true">
    <div class="sk-hero"><div class="sk-line short"></div><div class="sk-line hero"></div><div class="sk-line medium"></div></div>
    <div class="sk-tiles"><div class="sk-tile"></div><div class="sk-tile"></div></div>
  </div>`;
}

export function skeletonChart() {
  return `<div class="data-skeleton data-skeleton-chart" aria-hidden="true"><div class="sk-chart-area"></div></div>`;
}

export function skeletonInvGrid(count = 4) {
  return `<div class="data-skeleton data-skeleton-inv" aria-hidden="true">${Array.from({ length: count }, () => '<div class="sk-inv-card"><div class="sk-line medium"></div><div class="sk-line hero"></div></div>').join('')}</div>`;
}

export function debounce(fn, ms = 200) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
