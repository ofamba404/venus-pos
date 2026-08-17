/**
 * One-shot: set cookie flavor stock via service role.
 * Usage:
 *   $env:SUPABASE_SERVICE_ROLE_KEY="..."; node scripts/set-cookie-stock.mjs
 */
const URL = (process.env.SUPABASE_URL || 'https://xiangrykfxlnacthjcad.supabase.co').replace(
  /\/$/,
  '',
);
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

const TARGETS = {
  cookie_butterscotch: {
    stock: 16,
    display_name: 'Butterscotch',
    category_sub: 'Cookie',
    color: '#D4A355',
  },
  cookie_chocolate: {
    stock: 18,
    display_name: 'Chocolate',
    category_sub: 'Cookie',
    color: '#5c2e1f',
  },
  cookie_mint: {
    stock: 20,
    display_name: 'Mint',
    category_sub: 'Cookie',
    color: '#3CB043',
  },
  cookie_strawberry: {
    stock: 17,
    display_name: 'Strawberry',
    category_sub: 'Cookie',
    color: '#d81e2c',
  },
};

if (!KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

async function upsert(categoryId, meta) {
  const payload = {
    display_name: meta.display_name,
    category_sub: meta.category_sub,
    color: meta.color,
    stock: meta.stock,
    updated_at: new Date().toISOString(),
  };

  const patchRes = await fetch(
    `${URL}/rest/v1/inventory?category_id=eq.${encodeURIComponent(categoryId)}`,
    { method: 'PATCH', headers, body: JSON.stringify(payload) },
  );
  const patchData = await patchRes.json().catch(() => []);
  if (patchRes.ok && Array.isArray(patchData) && patchData.length > 0) {
    return patchData[0].stock;
  }

  const insRes = await fetch(`${URL}/rest/v1/inventory`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ category_id: categoryId, ...payload }),
  });
  const insData = await insRes.json().catch(() => []);
  if (!insRes.ok) {
    throw new Error(
      `${categoryId}: write failed ${patchRes.status}/${insRes.status} ${JSON.stringify(insData)}`,
    );
  }
  return Array.isArray(insData) && insData[0] ? insData[0].stock : meta.stock;
}

async function zeroLegacyCookie() {
  const payload = {
    display_name: 'Cookies',
    category_sub: '',
    color: '#d4af37',
    stock: 0,
    updated_at: new Date().toISOString(),
  };
  const res = await fetch(`${URL}/rest/v1/inventory?category_id=eq.cookie`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => []);
  if (!res.ok) throw new Error(`legacy cookie zero failed ${res.status}`);
  return Array.isArray(data) && data[0] ? data[0].stock : 0;
}

const results = {};
for (const [id, meta] of Object.entries(TARGETS)) {
  results[id] = await upsert(id, meta);
  console.log(`${id}=${results[id]}`);
}
results.cookie = await zeroLegacyCookie();
console.log(`cookie(legacy)=${results.cookie}`);
console.log('set-cookie-stock: ok', results);
