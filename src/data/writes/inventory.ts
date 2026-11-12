import { sbFetch } from '../api';

/** Inventory write bodies. The 405 fallback stays `{ stock }` — that is the proven contract. */

export function inventoryEnsureBody() {
  return { op: 'ensure' as const };
}

export function inventoryDeltaBody(categoryId: string, delta: number) {
  return { op: 'delta' as const, category_id: categoryId, delta };
}

export function inventoryPatchPath(categoryId: string) {
  return `inventory?category_id=eq.${encodeURIComponent(categoryId)}`;
}

export function inventoryPatchBody(stock: number) {
  return { stock };
}

/** 405/502/503 fallback. Prefer stays `return=minimal` — not the fuller v1 upsert. */
export function patchInventoryStock(categoryId: string, stock: number) {
  return sbFetch(inventoryPatchPath(categoryId), {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(inventoryPatchBody(stock)),
  });
}
