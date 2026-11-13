import type { CartLine, OrderMeta } from '../domain/cart';
import { cartTotal, isWalkInCheckout } from '../domain/cart';
import { features } from './env';
import { enqueueSale, shouldQueueSale } from './outbox';
import { applySoldToInventory, mergeSoldBreakdown } from '../domain/inventory-delta';
import { categoryLabel, soldExcludingHold } from '../domain/stock-reservation';
import { buildSalePostBody, type CheckoutDeliveryInput } from '../domain/sale-payload';
import { resolveDeliveryOrigin } from '../domain/geo';
import { functionFetch } from './api';
import { postClient } from './writes/clients';
import { postDelivery } from './writes/deliveries';
import { inventoryDeltaBody } from './writes/inventory';
import { postSale } from './writes/sales';
import { patchStoreOrder, storeOrderCheckedOutBody } from './writes/store-orders';
import { clients, ensureInventory, inventory, inventoryFresh, loadSales, storeOrders, syncLabel, type SaleRow } from './entities';
import { deviceId } from './device-id';
import { postStoreReserve } from './store-reserve';

export type StockOverride = {
  at: string;
  short: Record<string, number>;
  name?: string;
};

export type CheckoutInput = {
  lines: CartLine[];
  meta: OrderMeta;
  isCredit: boolean;
  checkout?: CheckoutDeliveryInput;
  clientId?: string | null;
  /** Staff confirmed "Sell anyway?" for a cart past system stock. */
  allowShortfall?: boolean;
  stockOverride?: StockOverride;
};

export type CheckoutResult =
  | {
      ok: true;
      sale: SaleRow;
      queued?: boolean;
      /** The delivery trip write. Runs after the sale is shown as recorded. */
      delivery?: Promise<void>;
      /** Resolves false when the store order could not be marked checked out (after retries). */
      orderMarked?: Promise<boolean>;
    }
  | { ok: false; error: string; restored: boolean };

let inFlight = false;

/** PostgREST returns an array; the test mock returns one object for a single insert. */
function rowsFrom<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') return [payload as T];
  return [];
}

async function resolveClientId(name: string, existingId: string): Promise<string | null> {
  if (existingId) {
    const hit = clients.value.find((c) => c.id === existingId);
    if (hit) return hit.id;
  }
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  const local = clients.value.find(
    (c) => String(c.name || '').trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (local) return local.id;

  const res = await postClient(trimmed);
  if (!res.ok) throw new Error(`Could not create client (${res.status})`);
  const row = rowsFrom<{ id: string }>(await res.json())[0];
  const id = row?.id || null;
  if (id) clients.value = [...clients.value, { id, name: trimmed }];
  return id;
}

export async function runCheckout(input: CheckoutInput): Promise<CheckoutResult> {
  if (inFlight) return { ok: false, error: 'Checkout already in progress', restored: false };
  if (!input.lines.length) return { ok: false, error: 'Cart is empty', restored: false };
  const clientName = String(input.meta.clientName || '').trim();
  const walkIn = features.walkInClient && isWalkInCheckout(input.meta, input.isCredit);
  if (input.isCredit && isWalkInCheckout(input.meta, false)) {
    return { ok: false, error: 'Credit needs a client name', restored: false };
  }
  if (!clientName && !walkIn) return { ok: false, error: 'Add a client to continue', restored: false };

  inFlight = true;
  let holdOrderId = '';
  let holdClaimed: Record<string, number> | null = null;
  let stockKnown = false;

  // Independent reads and writes go out together: the stock read (skipped while the last one is fresh), the
  // stock hold for a store order, and the client lookup or create. Each used to wait for the one before it.
  const storeOrderId = input.meta.storeOrderId;
  const stockRead = inventoryFresh()
    ? Promise.resolve()
    : ensureInventory()
        .then(() => undefined)
        .catch((e) => {
          console.warn('inventory refresh before charge failed', e);
        });
  const holdCall = storeOrderId
    ? postStoreReserve({ op: 'consume', id: storeOrderId, device_id: deviceId() })
    : null;
  const clientCall = (walkIn ? Promise.resolve(null) : resolveClientId(clientName, input.clientId || input.meta.clientId)).then(
    (id) => ({ ok: true as const, id }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  const [, hold, clientResult] = await Promise.all([stockRead, holdCall, clientCall]);
  stockKnown = syncLabel.value === 'live';

  if (hold) {
    if (hold.unsupported) {
      /* Function not deployed: deduct at charge, including store lines. */
    } else if (hold.network || !hold.ok) {
      inFlight = false;
      return {
        ok: false,
        error: hold.network
          ? 'No signal — this sale was not saved. Try again when you are back online.'
          : hold.message || hold.error || 'Could not lock this store order',
        restored: false,
      };
    } else if (hold.consumed || hold.reason === 'already_consumed') {
      holdOrderId = storeOrderId;
      holdClaimed = hold.claimed && typeof hold.claimed === 'object' ? hold.claimed : {};
    }
  }
  if (!clientResult.ok) {
    if (holdOrderId) {
      await postStoreReserve({ op: 'revert', id: holdOrderId, device_id: deviceId() }).catch(() => {});
    }
    inFlight = false;
    return {
      ok: false,
      error: clientResult.error instanceof Error ? clientResult.error.message : 'Could not save the sale',
      restored: true,
    };
  }

  const gross = mergeSoldBreakdown(
    input.lines.map((line) => ({ ...line, stockClaimed: false })),
  );
  const sold = holdClaimed ? soldExcludingHold(gross, holdClaimed) : gross;
  if (stockKnown && !input.allowShortfall) {
    for (const [id, qty] of Object.entries(sold)) {
      const have = inventory.value[id] || 0;
      if (qty > have) {
        if (holdOrderId) {
          await postStoreReserve({ op: 'revert', id: holdOrderId, device_id: deviceId() }).catch(
            () => {},
          );
        }
        inFlight = false;
        return {
          ok: false,
          error: `Not enough ${categoryLabel(id)} left (${have} in stock).`,
          restored: false,
        };
      }
    }
  }

  const snapshot = { ...inventory.value };
  inventory.value = applySoldToInventory(inventory.value, sold);
  let saleBody: Record<string, unknown> | null = null;

  try {
    const clientId = clientResult.id;
    const body = buildSalePostBody({
      lines: input.lines,
      meta: input.meta,
      clientId,
      isCredit: input.isCredit,
      checkout: input.checkout,
    });
    if (input.stockOverride) {
      const short = input.stockOverride.short || {};
      body.items = body.items.map((item) => {
        const hit = Object.keys(item.breakdown || {}).some((id) => short[id] != null);
        return hit ? { ...item, stock_override: input.stockOverride } : item;
      });
    }
    saleBody = body;
    const res = await postSale(body);
    if (!res.ok) {
      const err = new Error(`Sale failed (${res.status})`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    const sale = rowsFrom<SaleRow>(await res.json())[0];
    if (!sale) throw new Error('Sale failed — empty response');

    void Promise.all(
      Object.entries(sold).map(([category_id, qty]) =>
        functionFetch('/api/inventory/write', inventoryDeltaBody(category_id, -Number(qty))),
      ),
    ).catch((e) => console.warn('persist sold failed', e));

    // The sale is saved. Marking the order, refreshing the sale list and logging the trip carry on behind the success.
    const saleId = String(sale.id || '');
    let orderMarked: Promise<boolean> | undefined;
    if (storeOrderId) {
      storeOrders.value = storeOrders.value.map((row) =>
        row.id === storeOrderId ? { ...row, status: 'checked_out', sale_id: saleId } : row,
      );
      orderMarked = markOrderCheckedOut(storeOrderId, saleId);
    }
    void loadSales({ force: true }).catch(() => {});
    const delivery = recordDelivery({
      saleId: String(sale.id || ''),
      clientId,
      clientName,
      meta: input.meta,
      checkout: input.checkout,
    });
    return { ok: true, sale, delivery, orderMarked };
  } catch (e) {
    if (features.offlineQueue && saleBody && shouldQueueSale(e, input.meta.storeOrderId)) {
      const clientSaleId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `sale-${Date.now()}`;
      try {
        await enqueueSale({
          clientSaleId,
          body: { ...saleBody, client_sale_id: clientSaleId },
          deltas: sold,
          createdAt: new Date().toISOString(),
          label: clientName || 'Walk-in',
        });
        return {
          ok: true,
          queued: true,
          sale: {
            id: clientSaleId,
            total_ugx: cartTotal(input.lines),
            client_id: walkIn ? null : input.meta.clientId || null,
            is_credit: input.isCredit,
          },
        };
      } catch (queueError) {
        console.warn('offline queue failed', queueError);
      }
    }
    inventory.value = snapshot;
    if (holdOrderId) {
      await postStoreReserve({ op: 'revert', id: holdOrderId, device_id: deviceId() }).catch(
        (err) => {
          console.warn('revert store hold after failed charge', err);
        },
      );
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Could not save the sale',
      restored: true,
    };
  } finally {
    inFlight = false;
  }
}

/** Marks the order checked out with its sale. Retried, because the sale already exists and the order must leave Waiting. */
async function markOrderCheckedOut(orderId: string, saleId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await patchStoreOrder(orderId, storeOrderCheckedOutBody(saleId));
      if (res.ok) return true;
      console.warn('store order checkout patch failed', res.status);
    } catch (e) {
      console.warn('store order checkout patch failed', e);
    }
    await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
  }
  return false;
}

export function previewTotal(lines: CartLine[]) {
  return cartTotal(lines);
}

async function recordDelivery(input: {
  saleId: string;
  clientId: string | null;
  clientName: string;
  meta: OrderMeta;
  checkout?: CheckoutDeliveryInput;
}) {
  const checkout = input.checkout;
  if (!checkout || input.meta.deliveryEnabled === false) return;
  const lat = Number(checkout.dest?.lat);
  const lng = Number(checkout.dest?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const fee = parseInt(String(checkout.feeValue ?? ''), 10);
  const draft = checkout as CheckoutDeliveryInput & {
    feeManuallyEdited?: boolean;
    predictedFee?: number | null;
    origin?: { lat?: number | null; lng?: number | null } | null;
    originText?: string;
  };
  const origin = resolveDeliveryOrigin(
    draft.origin
      ? { lat: draft.origin.lat, lng: draft.origin.lng, label: draft.originText || 'GPS pickup' }
      : null,
  );
  try {
    await postDelivery({
        client_id: input.clientId,
        client_name: input.clientName || null,
        sale_id: input.saleId || null,
        origin_lat: origin.lat,
        origin_lng: origin.lng,
        origin_label: origin.label,
        dest_lat: lat,
        dest_lng: lng,
        dest_label: draft.destText || input.meta.deliveryLocationLabel || null,
        distance_km: draft.distanceKm == null ? null : Number(draft.distanceKm),
        duration_min: draft.durationMin == null ? null : Number(draft.durationMin),
        fee_ugx: Number.isFinite(fee) ? fee : 0,
        predicted_fee_ugx: draft.predictedFee == null ? null : Number(draft.predictedFee),
        fee_was_edited: Boolean(draft.feeManuallyEdited),
    });
  } catch (e) {
    console.warn('delivery log failed', e);
  }
}
