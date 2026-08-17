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
  cookie_butterscotch: 16,
  cookie_chocolate: 18,
  cookie_mint: 20,
  cookie_strawberry: 17,
};

if (!KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

async function upsert(categoryId, stock) {
  const payload = { stock, updated_at: new Date().toISOString() };
  const patchRes = await fetch(
    `${URL}/rest/v1/inventory?category_id=eq.${encodeURIComponent(categoryId)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(payload),
    },
  );
  const patchText = await patchRes.text();
  let patchData = [];
  try {
    patchData = patchText ? JSON.parse(patchText) : [];
  } catch {
    patchData = [];
  }
  if (patchRes.ok && Array.isArray(patchData) && patchData.length > 0) {
    return patchData[0].stock;
  }

  const insRes = await fetch(`${URL}/rest/v1/inventory`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ category_id: categoryId, ...payload }),
  });
  const insText = await insRes.text();
  let insData = [];
  try {
    insData = insText ? JSON.parse(insText) : [];
  } catch {
    insData = [];
  }
  if (!insRes.ok) {
    throw new Error(`${categoryId}: write failed ${patchRes.status}/${insRes.status} ${insText}`);
  }
  return Array.isArray(insData) && insData[0] ? insData[0].stock : stock;
}

const results = {};
for (const [id, stock] of Object.entries(TARGETS)) {
  results[id] = await upsert(id, stock);
  console.log(`${id}=${results[id]}`);
}
console.log('set-cookie-stock: ok', results);
