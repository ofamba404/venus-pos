import type { CartLine, OrderMeta } from '../domain/cart';
import { cartTotal, isWalkInCheckout } from '../domain/cart';
import { features } from './env';
import { applySoldToInventory, mergeSoldBreakdown } from '../domain/inventory-delta';
import { categoryLabel, soldExcludingHold } from '../domain/stock-reservation';
import { buildSalePostBody, type CheckoutDeliveryInput } from '../domain/sale-payload';
import { sbFetch, functionFetch } from './api';
import { clients, ensureInventory, inventory, loadSales, syncLabel, type SaleRow } from './entities';
import { deviceId } from './device-id';
import { postStoreReserve } from './store-reserve';

export type CheckoutInput = {
  lines: CartLine[];
  meta: OrderMeta;
  isCredit: boolean;
  checkout?: CheckoutDeliveryInput;
  clientId?: string | null;
};

export type CheckoutResult =
  | { ok: true; sale: SaleRow }
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

  const res = await sbFetch('clients', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ name: trimmed }),
  });
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
  if (!clientName && !walkIn) return { ok: false, error: 'Add a customer to continue', restored: false };

  inFlight = true;
  let holdOrderId = '';
  let holdClaimed: Record<string, number> | null = null;
  let stockKnown = false;
  try {
    await ensureInventory();
    stockKnown = syncLabel.value === 'live';
  } catch (e) {
    console.warn('inventory refresh before charge failed', e);
  }

  if (input.meta.storeOrderId) {
    const hold = await postStoreReserve({
      op: 'consume',
      id: input.meta.storeOrderId,
      device_id: deviceId(),
    });
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
      holdOrderId = input.meta.storeOrderId;
      holdClaimed = hold.claimed && typeof hold.claimed === 'object' ? hold.claimed : {};
    }
  }

  const gross = mergeSoldBreakdown(
    input.lines.map((line) => ({ ...line, stockClaimed: false })),
  );
  const sold = holdClaimed ? soldExcludingHold(gross, holdClaimed) : gross;
  if (stockKnown) {
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

  try {
    const clientId = walkIn
      ? null
      : await resolveClientId(clientName, input.clientId || input.meta.clientId);
    const body = buildSalePostBody({
      lines: input.lines,
      meta: input.meta,
      clientId,
      isCredit: input.isCredit,
      checkout: input.checkout,
    });
    const res = await sbFetch('sales', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Sale failed (${res.status})`);
    const sale = rowsFrom<SaleRow>(await res.json())[0];
    if (!sale) throw new Error('Sale failed — empty response');

    void Promise.all(
      Object.entries(sold).map(([category_id, qty]) =>
        functionFetch('/api/inventory/write', {
          op: 'delta',
          category_id,
          delta: -Number(qty),
        }),
      ),
    ).catch((e) => console.warn('persist sold failed', e));

    if (input.meta.storeOrderId) {
      try {
        const marked = await sbFetch(
          `store_orders?id=eq.${encodeURIComponent(input.meta.storeOrderId)}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ status: 'checked_out', sale_id: sale.id }),
          },
        );
        if (!marked.ok) console.warn('store order checkout patch failed', marked.status);
      } catch (e) {
        console.warn('store order checkout patch failed', e);
      }
    }

    void loadSales().catch(() => {});
    return { ok: true, sale };
  } catch (e) {
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

export function previewTotal(lines: CartLine[]) {
  return cartTotal(lines);
}
