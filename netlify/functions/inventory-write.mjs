import { env, json } from './_shared/push.mjs';
import { adminHeaders, requireStaffUser, supabaseConfig } from './_shared/supabase-admin.mjs';

/**
 * Single authoritative inventory write for Venus POS.
 * Uses the service role so RLS cannot return ambiguous empty representations.
 *
 * Body:
 *   { category_id, op: 'set', stock: number }
 *   { category_id, op: 'delta', delta: number }
 *
 * Response: { ok: true, category_id, stock }
 */

const ALLOWED = new Set([
  'mint',
  'strawberry',
  'blueberry',
  'watermelon',
  'grape',
  'coconut',
  'melon',
  'classic',
  'spliff5050',
  'spliff7030',
  'cookie_butterscotch',
  'cookie_chocolate',
  'cookie_mint',
  'cookie_strawberry',
]);

function clampStock(n) {
  return Math.max(0, Math.floor(Number(n) || 0));
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const { url, serviceKey, anonKey } = supabaseConfig();
  if (!serviceKey) {
    return json({ error: 'Server inventory write not configured (missing service role)' }, 503);
  }

  const user = await requireStaffUser(req, { url, anonKey });
  if (!user) return json({ error: 'Unauthorized' }, 401);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const categoryId = String(body?.category_id || '').trim();
  if (!ALLOWED.has(categoryId)) {
    return json({ error: `Unknown category: ${categoryId}` }, 400);
  }

  const op = String(body?.op || 'set').toLowerCase();
  let nextStock;

  try {
    if (op === 'delta') {
      const delta = Math.trunc(Number(body?.delta) || 0);
      const getRes = await fetch(
        `${url}/rest/v1/inventory?category_id=eq.${encodeURIComponent(categoryId)}&select=stock`,
        { headers: adminHeaders(serviceKey) },
      );
      if (!getRes.ok) {
        return json({ error: `Read failed (${getRes.status})` }, 502);
      }
      const rows = await getRes.json();
      const current = Array.isArray(rows) && rows[0] ? clampStock(rows[0].stock) : 0;
      nextStock = clampStock(current + delta);

      if (!Array.isArray(rows) || rows.length === 0) {
        const ins = await fetch(`${url}/rest/v1/inventory`, {
          method: 'POST',
          headers: adminHeaders(serviceKey, { Prefer: 'return=representation' }),
          body: JSON.stringify({
            category_id: categoryId,
            stock: nextStock,
            updated_at: new Date().toISOString(),
          }),
        });
        if (!ins.ok) {
          const detail = await ins.text().catch(() => '');
          return json({ error: `Insert failed (${ins.status})`, detail }, 502);
        }
        const inserted = await ins.json().catch(() => []);
        const stock = clampStock(inserted?.[0]?.stock ?? nextStock);
        return json({ ok: true, category_id: categoryId, stock });
      }
    } else if (op === 'set') {
      nextStock = clampStock(body?.stock);
    } else {
      return json({ error: `Unknown op: ${op}` }, 400);
    }

    const payload = { stock: nextStock, updated_at: new Date().toISOString() };
    const patch = await fetch(
      `${url}/rest/v1/inventory?category_id=eq.${encodeURIComponent(categoryId)}`,
      {
        method: 'PATCH',
        headers: adminHeaders(serviceKey, { Prefer: 'return=representation' }),
        body: JSON.stringify(payload),
      },
    );

    if (patch.ok) {
      const rows = await patch.json().catch(() => []);
      if (Array.isArray(rows) && rows.length > 0) {
        return json({
          ok: true,
          category_id: categoryId,
          stock: clampStock(rows[0].stock),
        });
      }
    }

    // Row missing — insert
    const ins = await fetch(`${url}/rest/v1/inventory`, {
      method: 'POST',
      headers: adminHeaders(serviceKey, { Prefer: 'return=representation' }),
      body: JSON.stringify({ category_id: categoryId, ...payload }),
    });
    if (ins.ok) {
      const rows = await ins.json().catch(() => []);
      return json({
        ok: true,
        category_id: categoryId,
        stock: clampStock(rows?.[0]?.stock ?? nextStock),
      });
    }

    if (ins.status === 409) {
      const retry = await fetch(
        `${url}/rest/v1/inventory?category_id=eq.${encodeURIComponent(categoryId)}`,
        {
          method: 'PATCH',
          headers: adminHeaders(serviceKey, { Prefer: 'return=representation' }),
          body: JSON.stringify(payload),
        },
      );
      if (retry.ok) {
        const rows = await retry.json().catch(() => []);
        if (Array.isArray(rows) && rows.length > 0) {
          return json({
            ok: true,
            category_id: categoryId,
            stock: clampStock(rows[0].stock),
          });
        }
      }
    }

    const detail = await (ins.ok ? patch : ins).text().catch(() => '');
    return json({ error: 'Write failed', detail, patch: patch.status, insert: ins.status }, 502);
  } catch (err) {
    console.error('inventory-write', err);
    return json({ error: err?.message || 'Write failed' }, 500);
  }
};

export const config = {
  path: '/api/inventory/write',
  method: ['POST', 'OPTIONS'],
};
