import { sbFetch } from './api.js';
import { readStaleCache, writeCache } from './cache.js';
import { salesCache } from './state.js';
import { showToast } from './utils.js';

function applySales(rows) {
  salesCache.length = 0;
  salesCache.push(...rows);
}

export function restoreSalesFromCache() {
  const stale = readStaleCache('sales');
  if (!stale?.length) return false;
  applySales(stale);
  return true;
}

export async function loadSalesToday() {
  const hadData = salesCache.length > 0;

  try {
    const res = await sbFetch('sales?select=*&order=created_at.desc&limit=200');
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    const rows = await res.json();
    writeCache('sales', rows);
    applySales(rows);
  } catch (e) {
    console.error('load sales failed', e);
    if (!hadData && !salesCache.length) {
      showToast('Could not load sales — check connection', true);
    }
  }
}
