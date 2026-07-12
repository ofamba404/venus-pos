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

export function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

let confirmResolve = null;

export function showConfirm(message) {
  const confirmOverlay = document.getElementById('confirmOverlay');
  const confirmMessageEl = document.getElementById('confirmMessage');
  if (!confirmOverlay || !confirmMessageEl) return Promise.resolve(false);
  confirmMessageEl.textContent = message;
  confirmOverlay.hidden = false;
  return new Promise((resolve) => {
    confirmResolve = resolve;
  });
}

export function resolveConfirm(result) {
  const confirmOverlay = document.getElementById('confirmOverlay');
  if (confirmOverlay) confirmOverlay.hidden = true;
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

export function setPageLoading(isLoading) {
  document.body.classList.toggle('is-loading', isLoading);
}

export function debounce(fn, ms = 200) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
