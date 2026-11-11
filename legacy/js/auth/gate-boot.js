/**
 * Earliest staff gate: redirect guests to auth.html before app JS runs.
 * Must load immediately after auth/config.js.
 */
(function bootPosAuthGate() {
  const cfg = window.VENUS_POS;
  if (!cfg || cfg.authGateEnabled !== true) return;

  const path = (window.location.pathname || '').toLowerCase();
  if (/(?:^|\/)auth\.html$/.test(path) || path.endsWith('/auth')) return;

  const LOOP_KEY = 'venus.pos.auth.gate.bounce';

  function peekSession() {
    try {
      const raw = localStorage.getItem(cfg.storageKey);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return Boolean(parsed?.access_token || parsed?.currentSession?.access_token);
    } catch {
      return false;
    }
  }

  function authHref() {
    const p = window.location.pathname || '';
    if (/\/pages(?:\/|$)/.test(p)) return '../auth.html';
    return 'auth.html';
  }

  function goAuth() {
    try {
      const now = Date.now();
      const prev = Number(sessionStorage.getItem(LOOP_KEY) || 0);
      if (prev && now - prev < 2500) {
        sessionStorage.removeItem(LOOP_KEY);
        return false;
      }
      sessionStorage.setItem(LOOP_KEY, String(now));
    } catch {
      /* private mode */
    }

    const next = window.location.pathname + window.location.search + window.location.hash;
    const href = authHref();
    const target =
      href + (next && !/auth\.html/i.test(next) ? '?next=' + encodeURIComponent(next) : '');
    window.location.replace(target);
    return true;
  }

  if (!peekSession()) {
    goAuth();
    return;
  }

  document.documentElement.classList.add('auth-checking');
  // Never leave the register blank if client.js / gate.js fail to load.
  setTimeout(function () {
    document.documentElement.classList.remove('auth-checking');
  }, 2000);
})();
