import { signal } from '@preact/signals';
import { KEYS } from './keys';
import { SUPABASE_URL, SUPABASE_ANON_JWT } from './env';

export type PosRole = 'pos_admin' | 'pos_staff';

export type AuthSession = {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  expires_in?: number;
  user?: { email?: string; app_metadata?: Record<string, unknown> };
};

const STAFF_PAGES = new Set(['sell', 'orders', 'stock', 'settings', 'more']);

export const authSession = signal<AuthSession | null>(null);
export const authRole = signal<PosRole | null>(null);
export const authReady = signal(false);

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    let padded = part.replace(/-/g, '+').replace(/_/g, '/');
    while (padded.length % 4) padded += '=';
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function roleFromSession(session: AuthSession | null): PosRole | null {
  if (!session?.access_token) return null;
  const meta = session.user?.app_metadata || {};
  const fromUser = String(meta.role || meta.pos_role || '');
  if (fromUser === 'pos_admin' || fromUser === 'pos_staff') return fromUser;
  const payload = decodeJwtPayload(session.access_token);
  const am = (payload?.app_metadata || {}) as Record<string, unknown>;
  const fromJwt = String(am.role || am.pos_role || '');
  if (fromJwt === 'pos_admin' || fromJwt === 'pos_staff') return fromJwt;
  return 'pos_staff';
}

export function readStoredSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(KEYS.auth);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const session = parsed?.access_token ? parsed : parsed?.currentSession;
    if (!session?.access_token) return null;
    return session as AuthSession;
  } catch {
    return null;
  }
}

export function writeStoredSession(session: AuthSession | null) {
  try {
    if (!session?.access_token) localStorage.removeItem(KEYS.auth);
    else localStorage.setItem(KEYS.auth, JSON.stringify(session));
  } catch {
    /* private mode */
  }
}

export function hydrateAuth() {
  const session = readStoredSession();
  authSession.value = session;
  authRole.value = roleFromSession(session);
  authReady.value = true;
  return session;
}

export function isAdmin() {
  return authRole.value === 'pos_admin';
}

export function canAccessPath(path: string) {
  const role = authRole.value;
  if (!role) return false;
  if (role === 'pos_admin') return true;
  const id = path.replace(/^\//, '').split('/')[0] || 'sell';
  return STAFF_PAGES.has(id);
}

export function peekAccessToken() {
  return authSession.value?.access_token || '';
}

export async function getAccessToken(): Promise<string> {
  const session = authSession.value;
  if (!session?.access_token) return '';
  const exp = Number(session.expires_at || 0);
  const now = Math.floor(Date.now() / 1000);
  if (exp && exp - now < 60 && session.refresh_token) {
    await refreshNow();
  }
  return authSession.value?.access_token || '';
}

export async function refreshNow(): Promise<AuthSession | null> {
  const refresh = authSession.value?.refresh_token;
  if (!refresh) return authSession.value;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_JWT,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) signOut();
    return null;
  }
  const next = (await res.json()) as AuthSession;
  if (!next.access_token) return null;
  if (next.expires_in && !next.expires_at) {
    next.expires_at = Math.floor(Date.now() / 1000) + Number(next.expires_in);
  }
  authSession.value = next;
  authRole.value = roleFromSession(next);
  writeStoredSession(next);
  return next;
}

export async function signIn(email: string, password: string): Promise<AuthSession> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_JWT,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(detail || `Sign-in failed (${res.status})`);
  }
  const session = (await res.json()) as AuthSession;
  if (session.expires_in && !session.expires_at) {
    session.expires_at = Math.floor(Date.now() / 1000) + Number(session.expires_in);
  }
  authSession.value = session;
  authRole.value = roleFromSession(session);
  writeStoredSession(session);
  return session;
}

export function authErrorMessage(raw: string, status = 0): string {
  const msg = String(raw || '');
  if (/invalid login|invalid credentials|invalid_grant/i.test(msg)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(msg)) return 'This email has not been confirmed yet. Ask the owner.';
  if (status === 429 || /rate limit|too many|429/i.test(msg)) return 'Too many attempts. Wait a minute and try again.';
  if (/not authorized|not_staff/i.test(msg)) return 'This account is not authorized for the register.';
  if (/should be different|same password/i.test(msg)) return 'Choose a password you have not used before.';
  if (/weak|at least \d+ characters/i.test(msg)) return msg;
  if (/failed to fetch|network|timeout|load failed/i.test(msg)) {
    return 'Cannot reach the login service. Check your connection and try again.';
  }
  return '';
}

/** Session carried by a Supabase recovery link (#access_token=…&type=recovery). */
export function recoverySessionFromHash(hash: string): AuthSession | null {
  const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const access = params.get('access_token');
  if (params.get('type') !== 'recovery' || !access) return null;
  const expiresIn = Number(params.get('expires_in')) || 3600;
  return {
    access_token: access,
    refresh_token: params.get('refresh_token') || undefined,
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
  };
}

export async function requestPasswordReset(email: string, redirectTo: string): Promise<void> {
  const res = await fetch(
    `${SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`,
    {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_JWT,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: email.trim() }),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(authErrorMessage(detail, res.status) || 'Could not send the reset link.');
  }
}

export async function updatePassword(password: string, accessToken: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: 'PUT',
    headers: {
      apikey: SUPABASE_ANON_JWT,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(authErrorMessage(detail, res.status) || 'Could not update the password.');
  }
}

export function signOut() {
  authSession.value = null;
  authRole.value = null;
  writeStoredSession(null);
}

/** Dev-friendly: allow browsing without auth on Vite. Tests can turn this off. */
export function allowDevBypass() {
  try {
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('venus-enforce-access') === '1') {
      return false;
    }
  } catch {
    /* private mode */
  }
  return typeof location !== 'undefined' && location.port === '5173';
}
