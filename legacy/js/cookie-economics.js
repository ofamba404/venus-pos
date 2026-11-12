/**
 * Loads cookie economics (wholesale costs + owner share) from the DB so revenue.js and the
 * commission views share one source of truth: public.cookie_costs / public.commission_settings.
 */
import { sbFetch } from './api.js';
import { applyCookieEconomics } from './config.js';

let loaded = null;

export function loadCookieEconomics() {
  if (loaded) return loaded;
  loaded = (async () => {
    try {
      const [costsRes, setRes] = await Promise.all([
        sbFetch('cookie_costs?select=category_id,wholesale_ugx'),
        sbFetch('commission_settings?select=key,value&key=eq.owner_cookie_share'),
      ]);
      if (!costsRes.ok || !setRes.ok) throw new Error(`${costsRes.status}/${setRes.status}`);
      const costs = await costsRes.json();
      const settings = await setRes.json();
      applyCookieEconomics({ ownerShare: settings?.[0]?.value, costs });
      return true;
    } catch (err) {
      console.warn('[cookie-economics] using built-in fallbacks', err);
      loaded = null;
      return false;
    }
  })();
  return loaded;
}
