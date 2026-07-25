/**
 * Confirm stored staff session after gate-boot.js.
 * Guests should already be on auth.html; this catches stale tokens and
 * non-staff accounts (e.g. storefront customers).
 */
(function initPosAuthGate() {
  const cfg = window.VENUS_POS;
  const enabled = cfg && cfg.authGateEnabled === true;

  function reveal() {
    document.documentElement.classList.remove('auth-checking');
  }

  if (!enabled) {
    reveal();
    return;
  }

  const path = (window.location.pathname || '').toLowerCase();
  const isAuthPage = /(?:^|\/)auth\.html$/.test(path) || path.endsWith('/auth');
  if (isAuthPage) {
    reveal();
    return;
  }

  const LOOP_KEY = 'venus.pos.auth.gate.bounce';

  function goAuth() {
    try {
      const now = Date.now();
      const prev = Number(sessionStorage.getItem(LOOP_KEY) || 0);
      if (prev && now - prev < 2500) {
        sessionStorage.removeItem(LOOP_KEY);
        reveal();
        return;
      }
      sessionStorage.setItem(LOOP_KEY, String(now));
    } catch {
      /* private mode */
    }

    const href = window.VenusPosAuth ? window.VenusPosAuth.authPageHref() : 'auth.html';
    const next = window.location.pathname + window.location.search + window.location.hash;
    const target =
      href + (next && !/auth\.html/i.test(next) ? '?next=' + encodeURIComponent(next) : '');
    window.location.replace(target);
  }

  if (window.VenusPosAuth?.hasStoredSession && !window.VenusPosAuth.hasStoredSession()) {
    goAuth();
    return;
  }

  document.documentElement.classList.add('auth-checking');

  function run() {
    if (!window.VenusPosAuth) {
      goAuth();
      return;
    }
    window.VenusPosAuth.ensureStaffSession()
      .then((session) => {
        if (!session) {
          return window.VenusPosAuth.signOut().finally(() => goAuth());
        }
        try {
          sessionStorage.removeItem(LOOP_KEY);
        } catch {
          /* ignore */
        }
        reveal();
      })
      .catch(() => {
        goAuth();
      });
  }

  run();
})();
