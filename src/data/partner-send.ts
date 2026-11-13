import { peekAccessToken } from './auth';
import { fetchCookiePartnerSettle, postCookiePartnerSettle, type ServerSettle } from './writes/partner';
import { proposeSettle } from '../domain/partner';
import { settledCutsFor, type PartnerSendFailure, type PartnerSendPlan } from '../domain/partner-send';

export type PartnerSendResult =
  | { ok: true; state: ServerSettle }
  | { ok: false; reason: PartnerSendFailure; status?: number; state?: ServerSettle };

function sum(list: number[]) {
  return list.reduce((a, b) => a + b, 0);
}

/**
 * Mark the offered batch sent, and report success only once the server confirms it.
 * Same order as v1: check the server first (another device may be ahead), then POST a
 * higher total only. On any failure nothing local moves. Never sends 0 or more than is open.
 */
export async function sendPartnerBatch(plan: PartnerSendPlan, current: ServerSettle): Promise<PartnerSendResult> {
  if (plan.count <= 0) return { ok: false, reason: 'nothing' };
  const proposed = proposeSettle(current.qty, settledCutsFor(current.qty, current.batches), plan.count);
  if (!proposed || sum(proposed.batches) !== proposed.qty) return { ok: false, reason: 'invalid' };
  if (!peekAccessToken()) return { ok: false, reason: 'auth' };

  let remote: ServerSettle | null;
  try {
    remote = await fetchCookiePartnerSettle();
  } catch {
    remote = null;
  }
  if (!remote) return { ok: false, reason: 'offline' };
  if (remote.qty > current.qty) return { ok: false, reason: 'stale', state: remote };

  let res: Response;
  try {
    res = await postCookiePartnerSettle(proposed.qty, proposed.batches, current.qty);
  } catch {
    return { ok: false, reason: 'offline' };
  }
  if (!res.ok) return { ok: false, reason: 'http', status: res.status };
  const data = (await res.json().catch(() => null)) as {
    ok?: boolean;
    applied?: boolean;
    settled_qty?: number;
    batches?: unknown;
  } | null;
  if (!data?.ok || data.settled_qty == null) return { ok: false, reason: 'http', status: res.status };

  const qty = Math.max(0, Math.floor(Number(data.settled_qty) || 0));
  const cuts = Array.isArray(data.batches)
    ? data.batches.map((n) => Math.floor(Number(n) || 0)).filter((n) => n > 0)
    : [];
  const batches = cuts.length && sum(cuts) === qty ? cuts : proposed.batches;
  if (qty === proposed.qty) return { ok: true, state: { qty, batches } };
  // The server kept an earlier total. Show what it has and stop.
  return { ok: false, reason: 'stale', state: { qty, batches: cuts.length && sum(cuts) === qty ? cuts : settledCutsFor(qty, cuts) } };
}
