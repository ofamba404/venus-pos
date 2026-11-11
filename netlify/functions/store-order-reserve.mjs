import { env, json } from './_shared/push.mjs';
import { adminHeaders, requireStaffUser, supabaseConfig } from './_shared/supabase-admin.mjs';
import {
  decideClaim,
  decideConsume,
  decideRevert,
  decideUnclaim,
  deliveryWithReservation,
  reservationOf,
  shortageMessage,
  unitsFromOrderItems,
} from '../../src/domain/stock-reservation.ts';

/**
 * Place / consume / release a storefront order's inventory hold.
 *
 * place: compare-and-swap deduct, then insert store_orders with
 * delivery.stock_reservation.state = 'held'.
 * consume: held → consumed. Charge must not deduct those units again.
 * release: held → released and add the units back. Staff may also release a
 * consumed hold that never received a sale_id (browser died mid-charge).
 *
 * Not a single database transaction. A crash between the stock CAS and the
 * order insert can hold units with no row until the next successful place of
 * that same id (idempotent) or a manual stock correction. Two places of
 * different orders are serialized per category by `stock=eq.<current>`.
 */

function header(req, name) {
  const lower = name.toLowerCase();
  try {
    if (typeof req?.headers?.get === 'function') {
      return req.headers.get(name) || req.headers.get(lower) || '';
    }
  } catch {
    /* ignore */
  }
  const headers = req?.headers || {};
  return headers[name] || headers[lower] || '';
}

function requestMethod(req) {
  const raw =
    (req && typeof req.method === 'string' && req.method) ||
    (req && typeof req.httpMethod === 'string' && req.httpMethod) ||
    '';
  return String(raw || 'POST').toUpperCase();
}

async function readJsonBody(req) {
  if (typeof req?.json === 'function') {
    try {
      return await req.json();
    } catch {
      return null;
    }
  }
  if (req?.body == null) return null;
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(String(req.body));
  } catch {
    return null;
  }
}

async function authorize(req, cfg) {
  const secret = env('PUSH_NOTIFY_SECRET');
  const provided = String(header(req, 'x-venus-push-secret') || '');
  if (secret && provided && provided === secret) return { ok: true, via: 'storefront' };
  const user = await requireStaffUser(req, cfg);
  if (user?.id) return { ok: true, via: 'staff' };
  if (!secret) return { ok: true, via: 'open' };
  return { ok: false, via: '' };
}

async function restJson(url, serviceKey, path, { method = 'GET', body, prefer } = {}) {
  const extra = {};
  if (prefer) extra.Prefer = prefer;
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: adminHeaders(serviceKey, extra),
    ...(body != null ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text().catch(() => '');
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { ok: res.ok, status: res.status, data, text };
}

function clamp(n) {
  return Math.max(0, Math.floor(Number(n) || 0));
}

async function readStock(url, serviceKey, categoryId) {
  const { ok, status, data } = await restJson(
    url,
    serviceKey,
    `inventory?category_id=eq.${encodeURIComponent(categoryId)}&select=category_id,stock`,
  );
  if (!ok || !Array.isArray(data)) {
    throw new Error(`Stock read failed (${status})`);
  }
  return data[0] ? { exists: true, stock: clamp(data[0].stock) } : { exists: false, stock: 0 };
}

async function casSetStock(url, serviceKey, categoryId, fromStock, toStock) {
  const patch = await restJson(
    url,
    serviceKey,
    `inventory?category_id=eq.${encodeURIComponent(categoryId)}&stock=eq.${clamp(fromStock)}`,
    {
      method: 'PATCH',
      body: { stock: clamp(toStock), updated_at: new Date().toISOString() },
      prefer: 'return=representation',
    },
  );
  return Boolean(patch.ok && Array.isArray(patch.data) && patch.data.length > 0);
}

async function adjustCategory(url, serviceKey, categoryId, delta) {
  const d = Math.trunc(Number(delta) || 0);
  if (d === 0) {
    const row = await readStock(url, serviceKey, categoryId);
    return { ok: true, stock: row.stock };
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const row = await readStock(url, serviceKey, categoryId);
    const next = row.stock + d;
    // No inventory row means this category is not tracked. Do not invent a zero
    // and do not fail the order — charge still deducts it if a row appears later.
    if (!row.exists && d < 0) return { ok: true, skipped: true };
    if (next < 0) return { ok: false, have: row.stock, need: -d };
    if (!row.exists) {
      const inserted = await restJson(url, serviceKey, 'inventory', {
        method: 'POST',
        body: {
          category_id: categoryId,
          display_name: categoryId,
          category_sub: '',
          color: '#888888',
          stock: next,
          updated_at: new Date().toISOString(),
        },
        prefer: 'return=representation',
      });
      if (inserted.ok) return { ok: true, stock: next };
      continue;
    }
    const won = await casSetStock(url, serviceKey, categoryId, row.stock, next);
    if (won) return { ok: true, stock: next };
  }
  return { ok: false, conflict: true, have: 0, need: Math.abs(d) };
}

async function applyUnits(url, serviceKey, units, direction) {
  const applied = [];
  for (const [id, qty] of Object.entries(units)) {
    if (qty <= 0) continue;
    const result = await adjustCategory(url, serviceKey, id, direction * qty);
    if (result.skipped) continue;
    if (!result.ok) {
      await applyUnits(url, serviceKey, Object.fromEntries(applied), -direction).catch((err) => {
        console.error('stock hold rollback failed', err);
      });
      return {
        ok: false,
        shortage: { [id]: { have: result.have ?? 0, need: qty } },
      };
    }
    applied.push([id, qty]);
  }
  return { ok: true, claimed: Object.fromEntries(applied) };
}

async function readOrder(url, serviceKey, id) {
  const { ok, status, data } = await restJson(
    url,
    serviceKey,
    `store_orders?id=eq.${encodeURIComponent(id)}&select=id,status,sale_id,delivery,items`,
  );
  if (!ok) throw new Error(`Order read failed (${status})`);
  return Array.isArray(data) && data[0] ? data[0] : null;
}

async function patchReservation(url, serviceKey, id, { fromState, body, saleMustBeNull = true }) {
  const filters = [
    `id=eq.${encodeURIComponent(id)}`,
    `status=neq.checked_out`,
    `delivery->stock_reservation->>state=eq.${fromState}`,
  ];
  if (saleMustBeNull) filters.push('sale_id=is.null');
  const { ok, data } = await restJson(url, serviceKey, `store_orders?${filters.join('&')}`, {
    method: 'PATCH',
    body,
    prefer: 'return=representation',
  });
  return Boolean(ok && Array.isArray(data) && data.length > 0);
}

function orderBody(order, reservation) {
  const delivery = deliveryWithReservation(order.delivery, reservation);
  const row = {
    id: order.id,
    status: 'pending',
    customer_name: String(order.customer_name || '').trim(),
    phone_e164: String(order.phone_e164 || ''),
    location_label: String(order.location_label || ''),
    location_lat: order.location_lat ?? null,
    location_lng: order.location_lng ?? null,
    delivery_enabled: order.delivery_enabled !== false,
    delivery,
    delivery_fee_ugx: order.delivery_fee_ugx ?? null,
    delivery_distance_km: order.delivery_distance_km ?? null,
    delivery_duration_min: order.delivery_duration_min ?? null,
    items: Array.isArray(order.items) ? order.items : [],
    item_count: Number(order.item_count) || 0,
    subtotal_ugx: Number(order.subtotal_ugx) || 0,
    confirm_message: String(order.confirm_message || ''),
    updated_at: new Date().toISOString(),
  };
  if (order.account_id) row.account_id = order.account_id;
  return row;
}

async function placeOrder(url, serviceKey, order) {
  const id = String(order?.id || '').trim();
  if (!id) return json({ ok: false, error: 'id required' }, 400);
  const existing = await readOrder(url, serviceKey, id);
  if (existing) {
    const reservation = reservationOf(existing);
    return json({
      ok: true,
      idempotent: true,
      order_id: id,
      reserved: reservation?.state === 'held' || reservation?.state === 'consumed',
      state: reservation?.state || null,
    });
  }

  const units = unitsFromOrderItems(order.items);
  const claimed = await applyUnits(url, serviceKey, units, -1);
  if (!claimed.ok) {
    return json(
      {
        ok: false,
        error: 'insufficient_stock',
        message: shortageMessage(claimed.shortage || {}),
        shortage: claimed.shortage || {},
      },
      409,
    );
  }

  const heldUnits = claimed.claimed || {};
  const reservation = {
    state: 'held',
    claimed: heldUnits,
    at: new Date().toISOString(),
  };
  const inserted = await restJson(url, serviceKey, 'store_orders', {
    method: 'POST',
    body: orderBody(order, reservation),
    prefer: 'return=representation',
  });
  if (inserted.ok) {
    return json({ ok: true, order_id: id, reserved: true, claimed: heldUnits });
  }

  await applyUnits(url, serviceKey, heldUnits, 1).catch((err) => {
    console.error('place rollback failed', err);
  });

  if (inserted.status === 409) {
    const winner = await readOrder(url, serviceKey, id);
    return json({
      ok: true,
      idempotent: true,
      order_id: id,
      state: reservationOf(winner)?.state || null,
    });
  }
  return json({ ok: false, error: 'insert_failed', message: 'Could not save the order.' }, 500);
}

function orderFlags(row) {
  return {
    sold: row?.status === 'checked_out' || Boolean(row?.sale_id),
    cancelled: row?.status === 'cancelled',
  };
}

function decisionJson(decision) {
  if (!decision.ok) {
    return json({ ok: false, error: decision.error, message: decision.message }, decision.status);
  }
  return null;
}

async function consumeOrder(url, serviceKey, id, deviceId) {
  const row = await readOrder(url, serviceKey, id);
  if (!row) return json({ ok: false, error: 'not_found', message: 'Order not found.' }, 404);
  let reservation = reservationOf(row);
  if (row.status === 'cancelled' && reservation?.state === 'held' && !reservation.claim_device) {
    await releaseOrder(url, serviceKey, id, { cancel: false, via: 'staff' });
  }
  const fresh = row.status === 'cancelled' ? (await readOrder(url, serviceKey, id)) || row : row;
  reservation = reservationOf(fresh) || reservation;
  const decision = decideConsume(reservation, deviceId, orderFlags(fresh));
  const denied = decisionJson(decision);
  if (denied) return denied;
  if (!decision.next) {
    return json({
      ok: true,
      consumed: false,
      reason: decision.reason || 'none',
      claimed: reservation?.claimed || {},
    });
  }

  const won = await patchReservation(url, serviceKey, id, {
    fromState: 'held',
    body: {
      delivery: deliveryWithReservation(fresh.delivery, decision.next),
      updated_at: new Date().toISOString(),
    },
  });
  if (!won) {
    const again = await readOrder(url, serviceKey, id);
    const againReservation = reservationOf(again);
    if (againReservation?.state === 'consumed') {
      return json({
        ok: true,
        consumed: false,
        reason: 'already_consumed',
        claimed: againReservation.claimed,
      });
    }
    return json(
      { ok: false, error: 'not_held', message: 'This store order is no longer waiting.' },
      409,
    );
  }
  return json({ ok: true, consumed: true, claimed: decision.next.claimed });
}

async function claimOrder(url, serviceKey, id, deviceId) {
  const row = await readOrder(url, serviceKey, id);
  if (!row) return json({ ok: false, error: 'not_found', message: 'Order not found.' }, 404);
  const reservation = reservationOf(row);
  const decision = decideClaim(reservation, deviceId, orderFlags(row));
  const denied = decisionJson(decision);
  if (denied) return denied;
  if (!decision.next) {
    return json({ ok: true, locked: false, reason: decision.reason || 'none' });
  }
  const won = await patchReservation(url, serviceKey, id, {
    fromState: reservation.state,
    body: {
      delivery: deliveryWithReservation(row.delivery, decision.next),
      updated_at: new Date().toISOString(),
    },
  });
  if (!won) {
    const again = await readOrder(url, serviceKey, id);
    const retry = decideClaim(reservationOf(again), deviceId, orderFlags(again || row));
    const retryDenied = decisionJson(retry);
    if (retryDenied) return retryDenied;
    if (!retry.next) return json({ ok: true, locked: true, reason: retry.reason || 'claimed' });
    return json(
      { ok: false, error: 'conflict', message: 'Could not claim this order. Try again.' },
      409,
    );
  }
  return json({ ok: true, locked: true });
}

async function unclaimOrder(url, serviceKey, id, deviceId) {
  const row = await readOrder(url, serviceKey, id);
  if (!row) return json({ ok: false, error: 'not_found', message: 'Order not found.' }, 404);
  const reservation = reservationOf(row);
  const decision = decideUnclaim(reservation, deviceId, { sold: orderFlags(row).sold });
  const denied = decisionJson(decision);
  if (denied) return denied;
  if (!decision.next) {
    return json({ ok: true, unclaimed: false, reason: decision.reason || 'none' });
  }
  const won = await patchReservation(url, serviceKey, id, {
    fromState: 'held',
    body: {
      delivery: deliveryWithReservation(row.delivery, decision.next),
      updated_at: new Date().toISOString(),
    },
  });
  if (!won) return json({ ok: true, unclaimed: false, reason: 'lost_race' });
  return json({ ok: true, unclaimed: true });
}

async function revertOrder(url, serviceKey, id, deviceId) {
  const row = await readOrder(url, serviceKey, id);
  if (!row) return json({ ok: false, error: 'not_found', message: 'Order not found.' }, 404);
  const decision = decideRevert(reservationOf(row), deviceId, { sold: orderFlags(row).sold });
  const denied = decisionJson(decision);
  if (denied) return denied;
  if (!decision.next) {
    return json({ ok: true, reverted: false, reason: decision.reason || 'none' });
  }
  const won = await patchReservation(url, serviceKey, id, {
    fromState: 'consumed',
    body: {
      delivery: deliveryWithReservation(row.delivery, decision.next),
      updated_at: new Date().toISOString(),
    },
  });
  if (!won) return json({ ok: true, reverted: false, reason: 'lost_race' });
  return json({ ok: true, reverted: true });
}

async function releaseOrder(url, serviceKey, id, { cancel, via }) {
  const row = await readOrder(url, serviceKey, id);
  if (!row) return json({ ok: false, error: 'not_found', message: 'Order not found.' }, 404);
  if (row.status === 'checked_out' || row.sale_id) {
    return json({ ok: true, released: false, reason: 'sold' });
  }
  const reservation = reservationOf(row);
  const state = reservation?.state || null;
  const staffCanUnwind = via === 'staff' && state === 'consumed' && !row.sale_id;
  const held = state === 'held';

  if (via !== 'staff' && held && reservation?.claim_device) {
    return json(
      {
        ok: false,
        error: 'in_checkout',
        message: 'The shop is already ringing this order up.',
      },
      409,
    );
  }

  if (held || staffCanUnwind) {
    const now = new Date().toISOString();
    const won = await patchReservation(url, serviceKey, id, {
      fromState: state,
      body: {
        ...(cancel ? { status: 'cancelled', cancelled_at: now } : {}),
        delivery: deliveryWithReservation(row.delivery, {
          ...reservation,
          state: 'released',
          released_at: now,
        }),
        updated_at: now,
      },
    });
    if (!won) return json({ ok: true, released: false, reason: 'lost_race' });
    const units = reservation?.claimed || {};
    const back = await applyUnits(url, serviceKey, units, 1);
    if (!back.ok) {
      console.error('release stock return failed', id, back.shortage);
      await patchReservation(url, serviceKey, id, {
        fromState: 'released',
        body: {
          ...(cancel ? { status: row.status || 'pending', cancelled_at: null } : {}),
          delivery: row.delivery,
          updated_at: new Date().toISOString(),
        },
      }).catch((err) => console.error('restore hold after failed release', err));
      return json(
        {
          ok: false,
          error: 'release_failed',
          message: 'Could not return stock. The order is still on hold.',
        },
        500,
      );
    }
    return json({ ok: true, released: true, claimed: units });
  }

  if (state === 'consumed' && via !== 'staff') {
    return json(
      {
        ok: false,
        error: 'in_checkout',
        message: 'The shop is already ringing this order up.',
      },
      409,
    );
  }

  if (cancel && row.status !== 'cancelled') {
    const now = new Date().toISOString();
    await restJson(url, serviceKey, `store_orders?id=eq.${encodeURIComponent(id)}&status=neq.checked_out`, {
      method: 'PATCH',
      body: { status: 'cancelled', cancelled_at: now, updated_at: now },
      prefer: 'return=minimal',
    });
  }
  return json({ ok: true, released: false, reason: state || 'none' });
}

export default async (req) => {
  const method = requestMethod(req);
  if (method === 'OPTIONS' || method === 'HEAD') return json({ ok: true });
  if (method !== 'POST') return json({ error: `Method not allowed (${method})` }, 405);

  const cfg = supabaseConfig();
  if (!cfg.serviceKey) {
    return json({ error: 'Server inventory write not configured (missing service role)' }, 503);
  }
  const auth = await authorize(req, cfg);
  if (!auth.ok) return json({ error: 'Unauthorized' }, 401);

  const body = await readJsonBody(req);
  if (!body || typeof body !== 'object') return json({ error: 'Invalid JSON' }, 400);
  const op = String(body.op || '').toLowerCase();

  try {
    if (op === 'place') return await placeOrder(cfg.url, cfg.serviceKey, body.order || body);
    const id = String(body.id || body.order_id || '').trim();
    if (!id) return json({ error: 'id required' }, 400);
    const deviceId = String(body.device_id || '');
    if (op === 'consume') return await consumeOrder(cfg.url, cfg.serviceKey, id, deviceId);
    if (op === 'claim') return await claimOrder(cfg.url, cfg.serviceKey, id, deviceId);
    if (op === 'unclaim') return await unclaimOrder(cfg.url, cfg.serviceKey, id, deviceId);
    if (op === 'revert') return await revertOrder(cfg.url, cfg.serviceKey, id, deviceId);
    if (op === 'release') {
      return await releaseOrder(cfg.url, cfg.serviceKey, id, {
        cancel: Boolean(body.cancel),
        via: auth.via,
      });
    }
    return json({ error: `Unknown op: ${op}` }, 400);
  } catch (err) {
    console.error('store-order-reserve', err);
    return json({ error: err?.message || 'Reserve failed' }, 500);
  }
};

export const config = {
  path: '/api/store-order/reserve',
};
