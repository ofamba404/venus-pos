/**
 * Sold breakdown → per-category stock deltas.
 * Ports the pure parts of `legacy/js/inventory.js` `persistSoldBreakdown`
 * and checkout merge in `legacy/js/orders.js`.
 */
import { CATEGORIES, normalizeInventoryBreakdown } from './catalog';

export type Breakdown = Record<string, number>;
export type CartLikeLine = {
  breakdown?: Record<string, unknown> | null;
  stockDeferred?: boolean;
};

const KNOWN_IDS = new Set(CATEGORIES.map((c) => c.id));

/** Merge cart line breakdowns the way checkout builds `mergedBreakdown` (includes stockDeferred). */
export function mergeSoldBreakdown(lines: CartLikeLine[] | null | undefined): Breakdown {
  const merged: Breakdown = {};
  (Array.isArray(lines) ? lines : []).forEach((item) => {
    Object.entries(normalizeInventoryBreakdown(item?.breakdown)).forEach(([id, qty]) => {
      merged[id] = (merged[id] || 0) + qty;
    });
  });
  return merged;
}

/**
 * Convert a sold-by-id map into negative inventory deltas for known categories only.
 * Mirrors `persistSoldBreakdown` entry filtering (qty > 0, known id).
 */
export function soldDeltas(
  soldById: Record<string, unknown> | null | undefined,
  knownIds: Set<string> = KNOWN_IDS,
): Breakdown {
  const entries = Object.entries(normalizeInventoryBreakdown(soldById)).filter(
    ([id, qty]) => knownIds.has(id) && Number(qty) > 0,
  );
  const out: Breakdown = {};
  for (const [id, qty] of entries) {
    out[id] = -Number(qty);
  }
  return out;
}

/** Checkout path: merge lines then produce deltas. */
export function cartSoldDeltas(lines: CartLikeLine[] | null | undefined): Breakdown {
  return soldDeltas(mergeSoldBreakdown(lines));
}

/**
 * Optimistic local inventory after a sale — matches checkout's
 * `Math.max(0, inventory[id] - qty)`.
 */
export function applySoldToInventory(
  inventory: Record<string, number>,
  soldById: Record<string, unknown> | null | undefined,
): Record<string, number> {
  const next = { ...inventory };
  for (const [id, qty] of Object.entries(normalizeInventoryBreakdown(soldById))) {
    if (!Object.prototype.hasOwnProperty.call(next, id)) continue;
    next[id] = Math.max(0, (next[id] || 0) - qty);
  }
  return next;
}

/**
 * Draft-stock reservation while editing the cart.
 * Stock-deferred store lines are skipped (v1 `adjustDraftForItem`).
 */
export function adjustDraftForItem(
  draft: Record<string, number>,
  item: CartLikeLine | null | undefined,
  direction: number,
): Record<string, number> {
  if (!item || item.stockDeferred) return { ...draft };
  const next = { ...draft };
  Object.entries(item.breakdown || {}).forEach(([id, qty]) => {
    next[id] = (next[id] || 0) + direction * Number(qty);
  });
  return next;
}
