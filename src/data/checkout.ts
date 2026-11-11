import type { CartLine, OrderMeta } from '../domain/cart';
import { cartTotal } from '../domain/cart';
import { applySoldToInventory, mergeSoldBreakdown } from '../domain/inventory-delta';
import { buildSalePostBody, type CheckoutDeliveryInput } from '../domain/sale-payload';
import { sbFetch, functionFetch } from './api';
import { clients, inventory, loadSales, type SaleRow } from './entities';

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
  if (!clientName) return { ok: false, error: 'Add a customer to continue', restored: false };

  inFlight = true;
  const sold = mergeSoldBreakdown(input.lines);
  const snapshot = { ...inventory.value };
  inventory.value = applySoldToInventory(inventory.value, sold);

  try {
    const clientId = await resolveClientId(clientName, input.clientId || input.meta.clientId);
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
      void sbFetch(`store_orders?id=eq.${encodeURIComponent(input.meta.storeOrderId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'checked_out', sale_id: sale.id }),
      }).catch((e) => console.warn('store order checkout patch failed', e));
    }

    void loadSales().catch(() => {});
    return { ok: true, sale };
  } catch (e) {
    inventory.value = snapshot;
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
