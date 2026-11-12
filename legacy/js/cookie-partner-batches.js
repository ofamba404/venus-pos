/**
 * Batch sizes already sent to the cookie partner.
 * A full batch is COOKIE_SETTLE_BATCH_MAX (keep equal to COOKIE_PARTNER_SETTLE_EVERY).
 * A partial send is a smaller positive size. The list sums to settled qty.
 */

export const COOKIE_SETTLE_BATCH_MAX = 25;

export function normalizeSettledBatches(raw, settledQty, maxBatch = COOKIE_SETTLE_BATCH_MAX) {
  const qty = Math.floor(Number(settledQty));
  if (!Number.isFinite(qty) || qty < 0) return null;
  if (!Array.isArray(raw)) return null;
  const max = Math.max(1, Math.floor(Number(maxBatch) || COOKIE_SETTLE_BATCH_MAX));
  if (raw.length > 500) return null;
  const cuts = [];
  for (const item of raw) {
    const n = Math.floor(Number(item));
    if (!Number.isFinite(n) || n <= 0 || n > max) return null;
    cuts.push(n);
  }
  let sum = 0;
  for (const n of cuts) sum += n;
  if (sum !== qty) return null;
  return cuts;
}

/** Legacy settled qty with no stored cuts: full batches, plus one trailing partial. */
export function synthesizeSettledBatches(settledQty, every = COOKIE_SETTLE_BATCH_MAX) {
  const qty = Math.max(0, Math.floor(Number(settledQty) || 0));
  const size = Math.max(1, Math.floor(Number(every) || COOKIE_SETTLE_BATCH_MAX));
  const full = Math.floor(qty / size);
  const rem = qty % size;
  const cuts = Array.from({ length: full }, () => size);
  if (rem) cuts.push(rem);
  return cuts;
}
