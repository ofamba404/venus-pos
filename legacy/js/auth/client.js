/**
 * POS auth — GoTrue over fetch.
 *
 * The register must never wait on the Supabase JS SDK / jsDelivr. A stored
 * staff session unlocks POS immediately; token refresh runs in the background
 * and only a proven 401/403 clears the session.
 */
(function initVenusPosAuth(global) {
  const cfg = global.VENUS_POS;
  if (!cfg) return;

  const ROLES = cfg.roles || { admin: 'pos_admin', staff: 'pos_staff' };
  const STAFF_PAGES = new Set(cfg.staffPages || ['home', 'inventory']);
  const AUTH_TIMEOUT_MS = 6000;
  const REFRESH_SKEW_S = 60;
  const REFRESH_POLL_MS = 30_000;

  /** @type {'pos_admin' | 'pos_staff' | null} */
  let cachedRole = null;
  /** @type {Promise<object|null> | null} */
  let refreshPromise = null;
  let refreshTimer = null;

  function withAbortTimeout(ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return { signal: ctrl.signal, cancel: () => clearTimeout(timer) };
  }

  function isTransient(err) {
    const msg = String(err?.message || err || '');
    const name = String(err?.name || '');
    const code = String(err?.code || '');
    const status = Number(err?.status || 0);
    return (
      code === 'auth_timeout' ||
      code === 'auth_network' ||
      name === 'AbortError' ||
      name === 'TypeError' ||
      name === 'AuthRetryableFetchError' ||
      (status >= 500 && status <= 599) ||
      /failed to fetch|network|load failed|timed out|timeout|Failed to load Supabase SDK|abort/i.test(
        msg,
      )
    );
  }

  function isInvalidSession(err) {
    const status = Number(err?.status || 0);
    const msg = String(err?.message || '');
    return status === 401 || status === 403 || /invalid.*(token|session|refresh)/i.test(msg);
  }

  function decodeJwtPayload(token) {
    try {
      const part = String(token || '').split('.')[1];
      if (!part) return null;
      let padded = part.replace(/-/g, '+').replace(/_/g, '/');
      while (padded.length % 4) padded += '=';
      const json = atob(padded);
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  function readStoredSession() {
    try {
      const raw = localStorage.getItem(cfg.storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const session = parsed?.access_token ? parsed : parsed?.currentSession;
      if (!session?.access_token) return null;
      return session;
    } catch {
      return null;
    }
  }

  function writeStoredSession(session) {
    try {
      if (!session?.access_token) {
        localStorage.removeItem(cfg.storageKey);
        return;
      }
      localStorage.setItem(cfg.storageKey, JSON.stringify(session));
    } catch {
      /* private mode */
    }
  }

  function clearStoredSession() {
    cachedRole = null;
    try {
      localStorage.removeItem(cfg.storageKey);
    } catch {
      /* ignore */
    }
  }

  function sessionExpiresAt(session) {
    if (session?.expires_at) return Number(session.expires_at) || 0;
    const payload = decodeJwtPayload(session?.access_token);
    return payload?.exp ? Number(payload.exp) : 0;
  }

  function needsRefresh(session) {
    const exp = sessionExpiresAt(session);
    if (!exp) return false;
    return exp - REFRESH_SKEW_S <= Date.now() / 1000;
  }

  function userFromSession(session) {
    if (session?.user?.app_metadata || session?.user?.id) return session.user;
    const payload = decodeJwtPayload(session?.access_token);
    if (!payload) return session?.user || null;
    return {
      id: payload.sub,
      email: payload.email,
      app_metadata: payload.app_metadata || {},
      user_metadata: payload.user_metadata || {},
    };
  }

  function roleFromUser(user) {
    if (!user) return null;
    const role = user.app_metadata?.role || user.app_metadata?.pos_role;
    if (role === ROLES.admin || role === ROLES.staff) return role;
    return null;
  }

  function isPosUser(user) {
    return Boolean(roleFromUser(user));
  }

  function isStaffUser(user) {
    return isPosUser(user);
  }

  function isAdminUser(user) {
    return roleFromUser(user) === ROLES.admin;
  }

  function normalizeSession(data) {
    const expires_at =
      Number(data.expires_at) ||
      (data.expires_in ? Math.floor(Date.now() / 1000) + Number(data.expires_in) : 0) ||
      sessionExpiresAt(data);
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      expires_at,
      token_type: data.token_type || 'bearer',
      user: data.user || userFromSession(data),
    };
  }

  function applySession(session) {
    if (!session?.access_token) {
      cachedRole = null;
      return null;
    }
    const user = userFromSession(session);
    const role = roleFromUser(user);
    if (!role) {
      cachedRole = null;
      return null;
    }
    cachedRole = role;
    return { ...session, user };
  }

  function staffSessionFromStore() {
    return applySession(readStoredSession());
  }

  function hasStoredSession() {
    return Boolean(readStoredSession()?.access_token);
  }

  function hasStoredStaffSession() {
    return Boolean(staffSessionFromStore());
  }

  function peekAccessToken() {
    return readStoredSession()?.access_token || '';
  }

  function canAccessPage(pageId, role = cachedRole) {
    if (!pageId) return false;
    if (role === ROLES.admin) return true;
    if (role === ROLES.staff) return STAFF_PAGES.has(pageId);
    return false;
  }

  function getRole() {
    return cachedRole;
  }

  function isAdmin() {
    return cachedRole === ROLES.admin;
  }

  function isStaffOnly() {
    return cachedRole === ROLES.staff;
  }

  async function authFetch(path, { method = 'POST', body, token, timeout = AUTH_TIMEOUT_MS } = {}) {
    const { signal, cancel } = withAbortTimeout(timeout);
    try {
      return await fetch(`${cfg.url}/auth/v1/${path}`, {
        method,
        signal,
        headers: {
          apikey: cfg.anonKey,
          Authorization: `Bearer ${token || cfg.anonKey}`,
          'Content-Type': 'application/json',
        },
        body: body != null ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      if (err?.name === 'AbortError') {
        const e = new Error('Auth request timed out');
        e.code = 'auth_timeout';
        throw e;
      }
      const e = new Error(err?.message || 'Failed to fetch');
      e.code = 'auth_network';
      throw e;
    } finally {
      cancel();
    }
  }

  async function parseAuthResponse(res) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(
        data.error_description || data.msg || data.message || data.error || `Auth ${res.status}`,
      );
      err.status = res.status;
      err.code = data.error || data.error_code || `http_${res.status}`;
      throw err;
    }
    return data;
  }

  function invalidateLocalSession() {
    const hadRole = Boolean(cachedRole);
    clearStoredSession();
    stopRefreshLoop();
    if (hadRole) {
      try {
        document.dispatchEvent(new CustomEvent('venus-pos-auth-invalid'));
      } catch {
        /* ignore */
      }
    }
  }

  async function refreshNow() {
    const stored = readStoredSession();
    if (!stored?.refresh_token) return null;
    if (!refreshPromise) {
      refreshPromise = (async () => {
        const data = await parseAuthResponse(
          await authFetch('token?grant_type=refresh_token', {
            body: { refresh_token: stored.refresh_token },
          }),
        );
        const next = normalizeSession({
          ...data,
          refresh_token: data.refresh_token || stored.refresh_token,
          user: data.user || stored.user,
        });
        const applied = applySession(next);
        if (!applied) {
          invalidateLocalSession();
          return null;
        }
        writeStoredSession(next);
        return applied;
      })().finally(() => {
        refreshPromise = null;
      });
    }
    return refreshPromise;
  }

  function stopRefreshLoop() {
    if (refreshTimer != null) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  function startRefreshLoop() {
    stopRefreshLoop();
    refreshTimer = setInterval(() => {
      const stored = readStoredSession();
      if (!stored) {
        stopRefreshLoop();
        return;
      }
      if (needsRefresh(stored)) {
        void refreshNow().catch((err) => {
          if (isInvalidSession(err)) invalidateLocalSession();
        });
      }
    }, REFRESH_POLL_MS);
  }

  async function getSession() {
    const stored = readStoredSession();
    if (!stored) {
      cachedRole = null;
      return null;
    }
    const local = applySession(stored);
    if (local && !needsRefresh(stored)) return local;

    try {
      const next = await refreshNow();
      return next || local;
    } catch (err) {
      if (isInvalidSession(err)) {
        invalidateLocalSession();
        return null;
      }
      if (isTransient(err) && local) return local;
      if (local) return local;
      throw err;
    }
  }

  async function getAccessToken() {
    const stored = readStoredSession();
    if (stored && needsRefresh(stored)) {
      try {
        const session = await getSession();
        return session?.access_token || stored.access_token || '';
      } catch {
        return stored.access_token || '';
      }
    }
    return stored?.access_token || '';
  }

  /**
   * Unlock POS from localStorage first. Network is best-effort and must not
   * return null on a transient failure when a staff session is already stored.
   */
  async function ensureStaffSession() {
    const local = staffSessionFromStore();
    if (local) {
      startRefreshLoop();
      if (needsRefresh(local)) {
        void refreshNow().catch((err) => {
          if (isInvalidSession(err)) invalidateLocalSession();
        });
      }
      return local;
    }
    if (!hasStoredSession()) return null;
    try {
      return await getSession();
    } catch (err) {
      if (isTransient(err)) return staffSessionFromStore();
      return null;
    }
  }

  async function signIn(email, password) {
    const data = await parseAuthResponse(
      await authFetch('token?grant_type=password', {
        body: {
          email: String(email || '').trim(),
          password: String(password || ''),
        },
      }),
    );
    const session = normalizeSession(data);
    const applied = applySession(session);
    if (!applied) {
      cachedRole = null;
      try {
        await authFetch('logout', { token: session.access_token, timeout: 2000 });
      } catch {
        /* ignore */
      }
      const err = new Error('This account is not authorized for POS.');
      err.code = 'not_staff';
      throw err;
    }
    writeStoredSession(session);
    startRefreshLoop();
    return applied;
  }

  async function signOut() {
    const token = peekAccessToken();
    invalidateLocalSession();
    if (!token) return;
    try {
      await authFetch('logout', { token, timeout: 2500 });
    } catch {
      /* already cleared locally */
    }
  }

  function authPageHref() {
    const path = global.location.pathname || '';
    if (/\/pages(?:\/|$)/.test(path)) return '../auth.html';
    return 'auth.html';
  }

  function homeHref() {
    const path = global.location.pathname || '';
    if (/\/pages(?:\/|$)/.test(path)) return '../index.html';
    return 'index.html';
  }

  /** Safe post-auth redirect from ?next= — blocks open redirects. */
  function resolveNextHref(search) {
    const params = new URLSearchParams(search || global.location.search || '');
    const next = params.get('next');
    if (
      next &&
      !next.includes('://') &&
      !next.startsWith('//') &&
      !next.includes('..') &&
      (next.startsWith('/') || /^[\w./-]+\.html(?:[?#].*)?$/.test(next))
    ) {
      if (cachedRole === ROLES.staff) {
        const page =
          /(?:^|\/)(?:pages\/)?(inventory|clients|reviews|delivery|history|analytics|admin)\.html/i.exec(
            next,
          )?.[1] || (/index\.html/i.test(next) || next === '/' ? 'home' : '');
        if (page && !canAccessPage(page, ROLES.staff)) return homeHref();
      }
      return next;
    }
    return homeHref();
  }

  staffSessionFromStore();
  if (cachedRole) startRefreshLoop();

  global.VenusPosAuth = {
    ROLES,
    STAFF_PAGES,
    getSession,
    getAccessToken,
    peekAccessToken,
    hasStoredSession,
    hasStoredStaffSession,
    staffSessionFromStore,
    ensureStaffSession,
    refreshNow,
    isPosUser,
    isStaffUser,
    isAdminUser,
    canAccessPage,
    getRole,
    isAdmin,
    isStaffOnly,
    signIn,
    signOut,
    authPageHref,
    homeHref,
    resolveNextHref,
    isTransientAuthError: isTransient,
  };
})(window);
