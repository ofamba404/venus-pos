/**
 * Sending a cookie partner batch: full or partial. Same rules as `sendCookiePartnerBatch`
 * in `legacy/js/revenue.js` (v1 PR #3), kept pure so the page and the tests share them.
 */
import { COOKIE_PARTNER_SETTLE_EVERY } from './catalog';
import { formatUGX } from './format';
import {
  cookiePartnerBatchesFromUnits,
  partialSendCount,
  type PartnerBatch,
  type PartnerUnit,
} from './partner';

export type PartnerSendKind = 'ready' | 'partial';

export type PartnerSendPlan = {
  kind: PartnerSendKind;
  /** Cookies this send settles. A full batch is `every`. A partial is what is open now. */
  count: number;
  /** The batch being sent, with its money and product lines. */
  batch: PartnerBatch;
  /** Batch number in the send history (settled batches + 1). */
  index: number;
  /** Further full batches that stay queued after this send. */
  queued: number;
};

export type PartnerSendFailure = 'nothing' | 'auth' | 'offline' | 'http' | 'stale' | 'invalid';

/**
 * Cut sizes that sum to the settled qty. The server's list when it adds up,
 * else full batches plus one trailing partial (v1 `synthesizeSettledBatches`).
 */
export function settledCutsFor(
  settledQty: number,
  cuts: Array<number | string> | null | undefined,
  every = COOKIE_PARTNER_SETTLE_EVERY,
): number[] {
  const qty = Math.max(0, Math.floor(Number(settledQty) || 0));
  const size = Math.max(1, Math.floor(Number(every) || COOKIE_PARTNER_SETTLE_EVERY));
  const list = (cuts || []).map((n) => Math.floor(Number(n) || 0));
  const sum = list.reduce((a, b) => a + b, 0);
  if (list.length && list.every((n) => n > 0 && n <= size) && sum === qty) return list;
  const out = Array.from({ length: Math.floor(qty / size) }, () => size);
  if (qty % size) out.push(qty % size);
  return out;
}

/** The send on offer, or null. A part-filled batch is offered only while no full batch waits. */
export function partnerSendPlan(
  units: PartnerUnit[] | null | undefined,
  settledQty: number,
  cuts: Array<number | string> | null | undefined,
  every = COOKIE_PARTNER_SETTLE_EVERY,
): PartnerSendPlan | null {
  const list = units || [];
  const qty = Math.min(Math.max(0, Math.floor(Number(settledQty) || 0)), list.length);
  const open = cookiePartnerBatchesFromUnits(list.slice(qty), every);
  const first = open[0];
  if (!first) return null;
  const readyBatches = open.filter((b) => b.complete).length;
  const readyCount = readyBatches > 0 ? every : 0;
  const index = settledCutsFor(qty, cuts, every).length + 1;
  if (readyCount > 0) {
    return { kind: 'ready', count: every, batch: { ...first, index }, index, queued: readyBatches - 1 };
  }
  const part = partialSendCount(first.cookieCount, every, readyCount);
  if (part <= 0) return null;
  return { kind: 'partial', count: part, batch: { ...first, index }, index, queued: 0 };
}

/** The sentence the owner confirms before anything is written. */
export function partnerConfirmText(plan: PartnerSendPlan): string {
  const b = plan.batch;
  const queued =
    plan.kind === 'ready' && plan.queued > 0
      ? ` ${plan.queued} more full batch${plan.queued === 1 ? '' : 'es'} stay queued.`
      : '';
  const part = plan.kind === 'partial' ? ` This is a part batch (${plan.count} of ${b.every}).` : '';
  return `Send ${formatUGX(b.partnerDue)} for ${plan.count} cookies (your split ${formatUGX(b.ownerSplit)}).${part}${queued}`;
}

export function partnerSendLabel(plan: PartnerSendPlan): string {
  return plan.kind === 'ready'
    ? `Send batch ${plan.index} · ${plan.count} cookies`
    : `Send part batch · ${plan.count} cookies`;
}

export function partnerFailureMessage(reason: PartnerSendFailure | undefined, status?: number): string {
  switch (reason) {
    case 'auth':
      return 'Not signed in. Batch NOT marked sent. Sign in again, then retry.';
    case 'stale':
      return 'Another device already updated this. Card refreshed. Check it, then retry if needed.';
    case 'http':
      return `Server error${status ? ` (${status})` : ''}. Batch NOT marked sent. Try again.`;
    case 'nothing':
    case 'invalid':
      return 'Nothing to send right now. Batch NOT marked sent.';
    default:
      return 'Could not reach the server. Batch NOT marked sent. Try again.';
  }
}
