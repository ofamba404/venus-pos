/**
 * POS Supabase auth — email/password + app_metadata.role.
 * Roles: pos_admin (full) | pos_staff (orders + inventory).
 */
(function initVenusPosAuth(global) {
  const cfg = global.VENUS_POS;
  if (!cfg) return;

  const ROLES = cfg.roles || { admin: 'pos_admin', staff: 'pos_staff' };
  const STAFF_PAGES = new Set(cfg.staffPages || ['home', 'inventory']);

  let clientPromise = null;
  /** @type {'pos_admin' | 'pos_staff' | null} */
  let cachedRole = null;

  function loadSupabaseSdk() {
    if (global.supabase?.createClient) return Promise.resolve(global.supabase);
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-venus-pos-supabase-sdk]');
      if (existing) {
        existing.addEventListener('load', () => resolve(global.supabase));
        existing.addEventListener('error', () => reject(new Error('Failed to load Supabase SDK')));
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      script.async = true;
      script.dataset.venusPosSupabaseSdk = 'true';
      script.onload = () => resolve(global.supabase);
      script.onerror = () => reject(new Error('Failed to load Supabase SDK'));
      document.head.appendChild(script);
    });
  }

  async function getClient() {
    if (!clientPromise) {
      clientPromise = loadSupabaseSdk().then((sdk) =>
        sdk.createClient(cfg.url, cfg.anonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
            storageKey: cfg.storageKey,
          },
        }),
      );
    }
    return clientPromise;
  }

  function hasStoredSession() {
    try {
      const raw = localStorage.getItem(cfg.storageKey);
      if (!raw) return false;
      return Boolean(JSON.parse(raw).access_token);
    } catch {
      return false;
    }
  }

  function peekAccessToken() {
    try {
      const raw = localStorage.getItem(cfg.storageKey);
      if (!raw) return '';
      return String(JSON.parse(raw).access_token || '');
    } catch {
      return '';
    }
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

  /** @deprecated use isPosUser — kept for older call sites */
  function isStaffUser(user) {
    return isPosUser(user);
  }

  function isAdminUser(user) {
    return roleFromUser(user) === ROLES.admin;
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

  async function getSession() {
    const client = await getClient();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return data.session;
  }

  async function getAccessToken() {
    const session = await getSession();
    return session?.access_token || '';
  }

  async function ensureStaffSession() {
    const session = await getSession();
    if (!session?.access_token || !isPosUser(session.user)) {
      cachedRole = null;
      return null;
    }
    cachedRole = roleFromUser(session.user);
    return session;
  }

  async function signIn(email, password) {
    const client = await getClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: String(email || '').trim(),
      password: String(password || ''),
    });
    if (error) throw error;
    if (!isPosUser(data.user)) {
      await client.auth.signOut();
      cachedRole = null;
      const err = new Error('This account is not authorized for POS.');
      err.code = 'not_staff';
      throw err;
    }
    cachedRole = roleFromUser(data.user);
    return data.session;
  }

  async function signOut() {
    cachedRole = null;
    const client = await getClient();
    await client.auth.signOut();
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
      // Staff must not land on admin-only pages via ?next=
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

  global.VenusPosAuth = {
    ROLES,
    STAFF_PAGES,
    getClient,
    getSession,
    getAccessToken,
    peekAccessToken,
    hasStoredSession,
    ensureStaffSession,
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
  };

  const path = global.location.pathname || '';
  if (!/(?:^|\/)auth\.html$/i.test(path) && hasStoredSession()) {
    void loadSupabaseSdk().catch(() => {});
  }
})(window);
