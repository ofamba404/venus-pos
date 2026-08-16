import { env } from './push.mjs';

/** Same project anon JWT as venus-pos/js/auth/config.js — used to validate staff sessions. */
const BUILTIN_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhpYW5ncnlrZnhsbmFjdGhqY2FkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxMjI2MDIsImV4cCI6MjA5ODY5ODYwMn0.O4IQo4aGqcSzWhE9H1szByvoblo07e7Pm3EL3v182b8';

export function supabaseConfig() {
  const url = (
    env('SUPABASE_URL') ||
    env('VITE_SUPABASE_URL') ||
    'https://xiangrykfxlnacthjcad.supabase.co'
  ).replace(/\/$/, '');
  const serviceKey =
    env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SERVICE_KEY') || '';
  const anonKey =
    env('SUPABASE_ANON_KEY') ||
    env('SUPABASE_ANON_JWT') ||
    env('VITE_SUPABASE_ANON_KEY') ||
    BUILTIN_ANON;
  return { url, serviceKey, anonKey };
}

export function adminHeaders(serviceKey, extra = {}) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

/** Validate a staff JWT via Supabase Auth. Returns user or null. */
export async function requireStaffUser(req, { url, anonKey }) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token || !url || !anonKey) return null;

  const res = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  return user?.id ? user : null;
}
