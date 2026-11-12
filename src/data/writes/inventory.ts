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
