/**
 * Storefront order stock holds.
 *
 * A successful place claims units out of on-hand inventory immediately.
 * Charge must not deduct those units again. Cancel returns them.
 * A failed charge reverts the lock to held and leaves the hold in place.
 * Orders placed before this hold existed have no reservation and still deduct at charge.
 */
import { CATEGORIES, CAT_MAP, canonicalInventoryCategoryId } from './catalog';

export type StockMap = Record<string, number>;
export type Shortage = Record<string, { have: number; need: number }>;

export type ReservationState = 'held' | 'consumed' | 'released';

export type StockReservation = {
  state: ReservationState;
  claimed: StockMap;
  at?: string;
  consumed_at?: string;
  /** Phone that loaded this order into a counter sale. One phone at a time. */
  claim_device?: string;
};

export type ReservationDecision =
  | { ok: true; reason: string; next?: StockReservation }
  | { ok: false; status: number; error: string; message: string };

const CLAIMED_ELSEWHERE = 'Another phone is ringing this order up.';

const KNOWN = new Set(CATEGORIES.map((c) => c.id));

export function categoryLabel(id: string): string {
  return CAT_MAP[id]?.name || id;
}

/** Positive known-category units on a store_orders items array. */
export function unitsFromOrderItems(items: unknown): StockMap {
  const merged: StockMap = {};
  const list = Array.isArray(items) ? items : [];
  for (const line of list) {
    if (!line || typeof line !== 'object') continue;
    const breakdown = (line as { breakdown?: unknown }).breakdown;
    if (!breakdown || typeof breakdown !== 'object') continue;
    for (const [rawId, rawQty] of Object.entries(breakdown as Record<string, unknown>)) {
      const qty = Math.floor(Number(rawQty));
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const id = canonicalInventoryCategoryId(rawId);
      if (!KNOWN.has(id)) continue;
      merged[id] = (merged[id] || 0) + qty;
    }
  }
  return merged;
}

export function reservationOf(order: { delivery?: unknown } | null | undefined): StockReservation | null {
  const delivery = order?.delivery;
  if (!delivery || typeof delivery !== 'object') return null;
  const raw = (delivery as { stock_reservation?: unknown }).stock_reservation;
  if (!raw || typeof raw !== 'object') return null;
  const state = (raw as { state?: unknown }).state;
  if (state !== 'held' && state !== 'consumed' && state !== 'released') return null;
  const claimed = unitsFromOrderItems([
    { breakdown: (raw as { claimed?: unknown }).claimed },
  ]);
  const claimDevice = (raw as { claim_device?: unknown }).claim_device;
  return {
    state,
    claimed,
    at: typeof (raw as { at?: unknown }).at === 'string' ? (raw as { at: string }).at : undefined,
    consumed_at:
      typeof (raw as { consumed_at?: unknown }).consumed_at === 'string'
        ? (raw as { consumed_at: string }).consumed_at
        : undefined,
    ...(typeof claimDevice === 'string' && claimDevice.trim()
      ? { claim_device: claimDevice.trim() }
      : {}),
  };
}

function deviceOf(deviceId: string): string {
  return String(deviceId || '').trim();
}

/** Put a consumed hold back to held without touching on-hand stock. */
export function reservationHeldAgain(reservation: StockReservation): StockReservation {
  return {
    state: 'held',
    claimed: reservation.claimed,
    ...(reservation.at ? { at: reservation.at } : {}),
    ...(reservation.claim_device ? { claim_device: reservation.claim_device } : {}),
  };
}

/**
 * One phone may load a store order. A second phone is refused until the first
 * unclaims it. Stock does not move.
 */
export function decideClaim(
  reservation: StockReservation | null,
  deviceId: string,
  flags: { sold?: boolean; cancelled?: boolean } = {},
): ReservationDecision {
  const device = deviceOf(deviceId);
  if (!device) {
    return {
      ok: false,
      status: 400,
      error: 'device_required',
      message: 'This phone could not be identified.',
    };
  }
  if (flags.sold) {
    return {
      ok: false,
      status: 409,
      error: 'already_charged',
      message: 'This store order is already charged.',
    };
  }
  if (flags.cancelled) {
    return {
      ok: false,
      status: 409,
      error: 'cancelled',
      message: 'This store order was cancelled.',
    };
  }
  if (!reservation) return { ok: true, reason: 'none' };
  if (reservation.state === 'released') {
    return {
      ok: false,
      status: 409,
      error: 'released',
      message: 'This store order is no longer held.',
    };
  }
  if (reservation.claim_device && reservation.claim_device !== device) {
    return { ok: false, status: 409, error: 'claimed', message: CLAIMED_ELSEWHERE };
  }
  if (reservation.state === 'consumed') return { ok: true, reason: 'already_consumed' };
  return {
    ok: true,
    reason: 'claimed',
    next: { ...reservation, claim_device: device },
  };
}

/** Same phone backs out of the cart. Stock stays held for the next phone. */
export function decideUnclaim(
  reservation: StockReservation | null,
  deviceId: string,
  flags: { sold?: boolean } = {},
): ReservationDecision {
  if (flags.sold || !reservation) return { ok: true, reason: 'none' };
  if (reservation.state !== 'held') return { ok: true, reason: reservation.state };
  const device = deviceOf(deviceId);
  if (reservation.claim_device && reservation.claim_device !== device) {
    return { ok: false, status: 409, error: 'claimed', message: CLAIMED_ELSEWHERE };
  }
  const next: StockReservation = {
    state: 'held',
    claimed: reservation.claimed,
    ...(reservation.at ? { at: reservation.at } : {}),
  };
  return { ok: true, reason: 'unclaimed', next };
}

/**
 * Charge lock. `next` is set only for the held → consumed transition.
 * A released hold must not be charged again (that would deduct twice).
 */
export function decideConsume(
  reservation: StockReservation | null,
  deviceId: string,
  flags: { sold?: boolean; cancelled?: boolean } = {},
): ReservationDecision {
  if (flags.sold) {
    return {
      ok: false,
      status: 409,
      error: 'already_charged',
      message: 'This store order is already charged.',
    };
  }
  if (flags.cancelled) {
    return {
      ok: false,
      status: 409,
      error: 'cancelled',
      message: 'This store order was cancelled.',
    };
  }
  if (!reservation) return { ok: true, reason: 'none' };
  if (reservation.state === 'released') {
    return {
      ok: false,
      status: 409,
      error: 'released',
      message: 'Stock for this order was already returned.',
    };
  }
  const device = deviceOf(deviceId);
  if (reservation.claim_device && device && reservation.claim_device !== device) {
    return { ok: false, status: 409, error: 'claimed', message: CLAIMED_ELSEWHERE };
  }
  if (reservation.state === 'consumed') return { ok: true, reason: 'already_consumed' };
  return {
    ok: true,
    reason: 'consumed',
    next: {
      ...reservation,
      state: 'consumed',
      consumed_at: new Date().toISOString(),
      ...(device ? { claim_device: reservation.claim_device || device } : {}),
    },
  };
}

/** Failed charge: consumed → held. On-hand stock stays as it was at place. */
export function decideRevert(
  reservation: StockReservation | null,
  deviceId: string,
  flags: { sold?: boolean } = {},
): ReservationDecision {
  if (flags.sold) return { ok: true, reason: 'sold' };
  if (!reservation || reservation.state !== 'consumed') {
    return { ok: true, reason: reservation?.state || 'none' };
  }
  const device = deviceOf(deviceId);
  if (reservation.claim_device && device && reservation.claim_device !== device) {
    return { ok: false, status: 409, error: 'claimed', message: CLAIMED_ELSEWHERE };
  }
  return { ok: true, reason: 'reverted', next: reservationHeldAgain(reservation) };
}

export function deliveryWithReservation(
  delivery: unknown,
  reservation: StockReservation,
): Record<string, unknown> {
  const base =
    delivery && typeof delivery === 'object' && !Array.isArray(delivery)
      ? { ...(delivery as Record<string, unknown>) }
      : {};
  return { ...base, stock_reservation: reservation };
}

/**
 * All-or-nothing claim against a stock snapshot.
 * Missing categories count as zero on hand.
 */
export function claimAgainstStock(
  stock: StockMap,
  units: StockMap,
): { ok: true; stock: StockMap } | { ok: false; stock: StockMap; shortage: Shortage } {
  const shortage: Shortage = {};
  for (const [id, need] of Object.entries(units)) {
    if (need <= 0) continue;
    const have = Math.max(0, Math.floor(Number(stock[id]) || 0));
    if (have < need) shortage[id] = { have, need };
  }
  if (Object.keys(shortage).length) return { ok: false, stock: { ...stock }, shortage };
  const next: StockMap = { ...stock };
  for (const [id, need] of Object.entries(units)) {
    if (need <= 0) continue;
    next[id] = Math.max(0, Math.floor(Number(next[id]) || 0) - need);
  }
  return { ok: true, stock: next };
}

export function releaseAgainstStock(stock: StockMap, units: StockMap): StockMap {
  const next: StockMap = { ...stock };
  for (const [id, qty] of Object.entries(units)) {
    if (qty <= 0) continue;
    next[id] = Math.max(0, Math.floor(Number(next[id]) || 0) + qty);
  }
  return next;
}

export function shortageMessage(shortage: Shortage): string {
  const parts = Object.entries(shortage).map(([id, row]) => {
    const noun = categoryLabel(id);
    return `${noun}: ${row.have} in stock, this order needs ${row.need}`;
  });
  if (!parts.length) return 'Not enough stock for this order.';
  return `Not enough stock. ${parts.join('. ')}.`;
}

/**
 * Charge deducts a line only when place-time claim did not already take it.
 * `stockDeferred` alone is the old behaviour (deduct at charge).
 */
export function soldExcludingHold(sold: StockMap, claimed: StockMap | null | undefined): StockMap {
  if (!claimed) return { ...sold };
  const next: StockMap = { ...sold };
  for (const [id, qty] of Object.entries(claimed)) {
    const have = next[id];
    if (qty <= 0 || have === undefined) continue;
    const left = have - qty;
    if (left > 0) next[id] = left;
    else delete next[id];
  }
  return next;
}

/**
 * Counter sellable count: on-hand minus the open counter cart.
 * Store lines are skipped — their units are already out of on-hand when claimed,
 * and legacy deferred lines were never drafted locally.
 */
export function counterSellable(
  onHand: StockMap,
  lines: Array<{
    breakdown?: Record<string, unknown> | null;
    stockClaimed?: boolean;
    stockDeferred?: boolean;
  }> | null | undefined,
): StockMap {
  const next: StockMap = { ...onHand };
  for (const line of lines || []) {
    if (!line || line.stockClaimed || line.stockDeferred) continue;
    const units = unitsFromOrderItems([{ breakdown: line.breakdown }]);
    for (const [id, qty] of Object.entries(units)) {
      if (!Object.prototype.hasOwnProperty.call(next, id)) continue;
      next[id] = Math.max(0, (next[id] || 0) - qty);
    }
  }
  return next;
}

export type JointPackSpec = {
  slots: number;
  fixed: string | null;
  pool: string[];
};

/** Same pack math the storefront uses for card-level availability. */
export function availableFromPools(
  remaining: (id: string) => number | null,
  pack: JointPackSpec,
): number | null {
  let choice = 0;
  let knownChoice = false;
  for (const id of pack.pool) {
    const left = remaining(id);
    if (left === null) continue;
    knownChoice = true;
    choice += Math.max(0, left);
  }
  const fromChoice = knownChoice ? Math.floor(choice / pack.slots) : null;
  if (!pack.fixed) return fromChoice;
  const fixedLeft = remaining(pack.fixed);
  if (fromChoice === null || fixedLeft === null) return null;
  return Math.min(Math.max(0, fixedLeft), fromChoice);
}
