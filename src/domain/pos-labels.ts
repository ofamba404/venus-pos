/** Staff-facing storefront names. Stale after 5 minutes, same as `legacy/js/pos-labels.js`. */

export const POS_LABEL_STALE_MS = 5 * 60_000;

export type PosLabelRow = {
  id?: string;
  snapchat_name?: string | null;
  pos_display_name?: string | null;
};

export type PosLabelSource = {
  account_id?: string | null;
  customer_name?: string | null;
  snapchat_name?: string | null;
  pos_display_name?: string | null;
};

export type PosLabelIndex = {
  byAccountId: Map<string, string>;
  bySnapchat: Map<string, string>;
};

export function labelsAreStale(loadedAt: number, now: number, staleMs = POS_LABEL_STALE_MS): boolean {
  if (!loadedAt) return true;
  return now - loadedAt >= staleMs;
}

export function buildPosLabelIndex(rows: PosLabelRow[] | null | undefined): PosLabelIndex {
  const byAccountId = new Map<string, string>();
  const bySnapchat = new Map<string, string>();
  for (const row of rows || []) {
    if (!row) continue;
    const snap = String(row.snapchat_name || '').trim();
    const alias = String(row.pos_display_name || '').trim();
    const label = alias || snap;
    if (row.id && label) byAccountId.set(String(row.id), label);
    if (snap && alias) bySnapchat.set(snap.toLowerCase(), alias);
  }
  return { byAccountId, bySnapchat };
}

export function posCustomerLabel(
  source: PosLabelSource | null | undefined,
  index: PosLabelIndex,
  fallback = 'Customer',
): string {
  if (!source) return fallback;
  const direct = String(source.pos_display_name || '').trim();
  if (direct) return direct;
  const accountId = source.account_id ? String(source.account_id) : '';
  if (accountId && index.byAccountId.has(accountId)) {
    return index.byAccountId.get(accountId) || fallback;
  }
  const snap = String(source.customer_name || source.snapchat_name || '').trim();
  if (snap) {
    const alias = index.bySnapchat.get(snap.toLowerCase());
    if (alias) return alias;
    return snap;
  }
  return fallback;
}
