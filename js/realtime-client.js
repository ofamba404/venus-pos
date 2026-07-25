/**
 * Lazy Supabase Realtime client for near-instant store_orders sync.
 * Uses the staff session JWT so RLS applies to realtime payloads.
 */
import { SUPABASE_URL, SUPABASE_ANON_JWT } from './config.js';

/** @type {Promise<import('@supabase/supabase-js').SupabaseClient> | null} */
let clientPromise = null;

export function getRealtimeClient() {
  if (!clientPromise) {
    clientPromise = import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm')
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

        const token =
          (await window.VenusPosAuth?.getAccessToken?.().catch(() => '')) ||
          window.VenusPosAuth?.peekAccessToken?.() ||
          '';
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
