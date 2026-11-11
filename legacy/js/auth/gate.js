/**
 * Confirm stored staff session after gate-boot.js.
 * Unlock from localStorage immediately — never wait on network or the SDK.
 * Only bounce to login when there is no staff session, or live auth proves
 * the session was revoked (storage cleared).
 */
(function initPosAuthGate() {
  const cfg = window.VENUS_POS;
  const enabled = cfg && cfg.authGateEnabled === true;
  const REVEAL_WATCHDOG_MS = 1200;

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
  setTimeout(reveal, REVEAL_WATCHDOG_MS);

  function peekToken() {
    try {
      const raw = localStorage.getItem(cfg.storageKey);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return Boolean(parsed?.access_token || parsed?.currentSession?.access_token);
    } catch {
      return false;
    }
  }

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

  const hasStaff = Boolean(
    window.VenusPosAuth?.hasStoredStaffSession?.() ||
      window.VenusPosAuth?.staffSessionFromStore?.() ||
      window.VenusPosAuth?.hasStoredSession?.(),
  );

  if (hasStaff) {
    reveal();
    try {
      sessionStorage.removeItem(LOOP_KEY);
    } catch {
      /* ignore */
    }
    document.addEventListener('venus-pos-auth-invalid', goAuth);
    void window.VenusPosAuth.ensureStaffSession()
      .then((session) => {
        if (session) return;
        if (
          !window.VenusPosAuth.hasStoredStaffSession?.() &&
          !window.VenusPosAuth.hasStoredSession?.()
        ) {
          goAuth();
        }
      })
      .catch(() => {});
    return;
  }

  if (peekToken() && !window.VenusPosAuth) {
    // Auth script failed to load — keep the register open rather than stall.
    reveal();
    return;
  }

  goAuth();
})();
