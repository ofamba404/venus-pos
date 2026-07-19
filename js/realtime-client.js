/**
 * Lazy Supabase Realtime client for near-instant store_orders sync.
 * Loaded on demand so the POS shell stays light until runtime needs it.
 */
import { SUPABASE_URL, SUPABASE_ANON_JWT } from './config.js';

/** @type {Promise<import('@supabase/supabase-js').SupabaseClient> | null} */
let clientPromise = null;

export function getRealtimeClient() {
  if (!clientPromise) {
    clientPromise = import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm')
      .then(({ createClient }) =>
        createClient(SUPABASE_URL, SUPABASE_ANON_JWT, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
          realtime: {
            params: { eventsPerSecond: 10 },
          },
        }),
      )
      .catch((err) => {
        clientPromise = null;
        throw err;
      });
  }
  return clientPromise;
}
