import {
  COOKIE_SETTLE_BATCH_MAX,
  normalizeSettledBatches,
  synthesizeSettledBatches,
} from '../../../js/cookie-partner-batches.js';

export function clampQty(n) {
  return Math.max(0, Math.floor(Number(n) || 0));
}

function isPrefix(prefix, list) {
  if (!Array.isArray(prefix) || !Array.isArray(list) || prefix.length > list.length) return false;
  return prefix.every((n, i) => n === list[i]);
}

/**
 * Monotonic merge of a settle write into the stored state.
 * The settled qty only ever goes up. A stale client posting a lower or equal qty changes nothing
 * and gets the stored state back, so it adopts it. Stored batch cuts are never dropped:
 * new cuts must extend them, otherwise they are rebuilt from them.
 *
 * @returns {{
 *   ok: boolean, error?: string, applied: boolean, qty: number, batches: number[] | null,
 *   writeBatches: boolean, batchSize: number, qtyBefore: number
 * }}
 */
export function mergeSettleWrite({ currentQty, currentBatches, bodyQty, bodyBatches }) {
  const cur = clampQty(currentQty);
  const next = clampQty(bodyQty);
  const curCuts = normalizeSettledBatches(currentBatches, cur);
  const base = { qtyBefore: cur, batchSize: 0, writeBatches: false };

  if (next <= cur) {
    // Stale or duplicate write: keep stored qty. Only fill in cuts if none are stored for it.
    if (next === cur && !curCuts && bodyBatches != null) {
      const cuts = normalizeSettledBatches(bodyBatches, cur);
      if (cuts) return { ...base, ok: true, applied: false, qty: cur, batches: cuts, writeBatches: true };
    }
    return { ...base, ok: true, applied: false, qty: cur, batches: curCuts };
  }

  const prior = curCuts || synthesizeSettledBatches(cur, COOKIE_SETTLE_BATCH_MAX);
  let cuts = null;
  if (bodyBatches != null) {
    cuts = normalizeSettledBatches(bodyBatches, next);
    if (!cuts) return { ...base, ok: false, error: 'Invalid batches', applied: false, qty: cur, batches: curCuts };
    if (!isPrefix(prior, cuts)) cuts = null; // would rewrite history: keep stored cuts instead
  }
  if (!cuts) {
    cuts = normalizeSettledBatches(
      [...prior, ...synthesizeSettledBatches(next - cur, COOKIE_SETTLE_BATCH_MAX)],
      next,
    );
  }
  return {
    ...base,
    ok: true,
    applied: true,
    qty: next,
    batches: cuts,
    writeBatches: Boolean(cuts),
    batchSize: next - cur,
  };
}

export function auditEntry({ at, qtyBefore, qtyAfter, batchSize, by }) {
  return {
    at: at || new Date().toISOString(),
    qty_before: qtyBefore,
    qty_after: qtyAfter,
    batch_size: batchSize,
    by: by || null,
  };
}
