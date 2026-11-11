/**
 * Lazy Supabase Realtime client for near-instant store_orders sync.
 * Optional: poll fallback in store-orders.js keeps the register working if
 * the SDK/CDN never loads. Must never block POS boot or auth.
 */
import { SUPABASE_URL, SUPABASE_ANON_JWT } from './config.js';

/** @type {Promise<import('@supabase/supabase-js').SupabaseClient> | null} */
let clientPromise = null;

const SDK_TIMEOUT_MS = 4000;
const SDK_ESM_URLS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm',
  'https://unpkg.com/@supabase/supabase-js@2.49.8/+esm',
];

async function resolveAccessToken() {
  return (
    window.VenusPosAuth?.peekAccessToken?.() ||
    (await window.VenusPosAuth?.getAccessToken?.().catch(() => '')) ||
    ''
  );
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function loadRealtimeSdk() {
  if (window.supabase?.createClient) return { createClient: window.supabase.createClient };
  let lastErr = null;
  for (const url of SDK_ESM_URLS) {
    try {
      const mod = await withTimeout(import(url), SDK_TIMEOUT_MS, 'Realtime SDK timed out');
      if (mod?.createClient) return mod;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Failed to load Realtime SDK');
}

/** Keep Realtime RLS in sync with the auth client's refreshed JWT. */
export async function refreshRealtimeAuth() {
  const client = await getRealtimeClient();
  const token = await resolveAccessToken();
  if (token) client.realtime.setAuth(token);
  return client;
}

export function getRealtimeClient() {
  if (!clientPromise) {
    clientPromise = loadRealtimeSdk()
      .then(async ({ createClient }) => {
        const client = createClient(SUPABASE_URL, SUPABASE_ANON_JWT, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
          realtime: {
            params: { eventsPerSecond: 10 },
          },
        });

        const token = await resolveAccessToken();
        if (token) {
          client.realtime.setAuth(token);
        }
        return client;
      })
      .catch((err) => {
        clientPromise = null;
        throw err;
      });
  }
  return clientPromise;
}

/** Drop the cached client after sign-out so the next boot uses a fresh token. */
export function resetRealtimeClient() {
  clientPromise = null;
}
