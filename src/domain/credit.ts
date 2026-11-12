/** Outstanding credit helpers — port of `js/credit.js`. */

export type CreditSale = {
  id?: string;
  client_id?: string | null;
  is_credit?: boolean;
  credit_cleared?: boolean;
  total_ugx?: number;
  amount_paid_ugx?: number;
  created_at?: string;
};

export type ClientRow = { id: string; name?: string };

export function isOutstandingCredit(sale: CreditSale | null | undefined): boolean {
  return Boolean(sale?.is_credit && !sale.credit_cleared);
}

export function creditBalance(sale: CreditSale | null | undefined): number {
  if (!isOutstandingCredit(sale)) return 0;
  const total = Number(sale!.total_ugx) || 0;
  const paid = Math.max(0, Number(sale!.amount_paid_ugx) || 0);
  return Math.max(0, total - paid);
}

export function getOutstandingCredit(sales: CreditSale[] | null | undefined): CreditSale[] {
  return (sales || []).filter((s) => creditBalance(s) > 0);
}

export function getClientOutstandingCredit(
  sales: CreditSale[] | null | undefined,
  clientId: string | null | undefined,
): CreditSale[] {
  if (!clientId) return [];
  return getOutstandingCredit(sales).filter((s) => s.client_id === clientId);
}

export function sumCreditOwed(sales: CreditSale[] | null | undefined): number {
  return (sales || []).reduce((sum, s) => sum + creditBalance(s), 0);
}

export function allocatePaymentFifo(
  openSales: CreditSale[] | null | undefined,
  amountUgx: number,
): Array<{ sale: CreditSale; applyUgx: number; newPaid: number; clears: boolean }> {
  let remaining = Math.max(0, Math.round(Number(amountUgx) || 0));
  if (remaining <= 0) return [];

  const sorted = [...(openSales || [])].sort(
    (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime(),
  );

  const allocations: Array<{
    sale: CreditSale;
    applyUgx: number;
    newPaid: number;
    clears: boolean;
  }> = [];
  for (const sale of sorted) {
    if (remaining <= 0) break;
    const balance = creditBalance(sale);
    if (balance <= 0) continue;
    const applyUgx = Math.min(balance, remaining);
    const prevPaid = Math.max(0, Number(sale.amount_paid_ugx) || 0);
    const newPaid = prevPaid + applyUgx;
    const total = Number(sale.total_ugx) || 0;
    allocations.push({
      sale,
      applyUgx,
      newPaid,
      clears: newPaid >= total,
    });
    remaining -= applyUgx;
  }
  return allocations;
}

export function groupOutstandingByClient(
  outstandingSales: CreditSale[],
  clientsList: ClientRow[] = [],
) {
  const byKey = new Map<
    string,
    { key: string; clientId: string; name: string; sales: CreditSale[]; totalUgx: number }
  >();

  for (const sale of outstandingSales) {
    const clientId = sale.client_id || '';
    const key = clientId || `unknown-${sale.id}`;
    let group = byKey.get(key);
    if (!group) {
      const client = clientId ? clientsList.find((c) => c.id === clientId) : null;
      group = {
        key,
        clientId,
        name: client?.name || 'Unknown client',
        sales: [],
        totalUgx: 0,
      };
      byKey.set(key, group);
    }
    group.sales.push(sale);
    group.totalUgx += creditBalance(sale);
  }

  const byName = new Map<string, (typeof byKey extends Map<string, infer V> ? V : never)>();
  for (const group of byKey.values()) {
    const nameKey = group.name.trim().toLowerCase();
    const mergeKey =
      nameKey && nameKey !== 'unknown client' ? `name:${nameKey}` : `id:${group.key}`;
    const existing = byName.get(mergeKey);
    if (!existing) {
      byName.set(mergeKey, {
        ...group,
        sales: [...group.sales],
      });
      continue;
    }
    existing.sales.push(...group.sales);
    existing.totalUgx += group.totalUgx;
    if (!existing.clientId && group.clientId) {
      existing.clientId = group.clientId;
      existing.key = group.key;
    }
  }

  for (const group of byName.values()) {
    group.sales.sort(
      (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime(),
    );
  }

  return [...byName.values()].sort((a, b) => {
    if (b.totalUgx !== a.totalUgx) return b.totalUgx - a.totalUgx;
    return a.name.localeCompare(b.name);
  });
}

/** Open credit for every client row whose name matches, so a typed name stacks. */
export function openDebtForClientName(
  name: string,
  clientsList: ClientRow[] | null | undefined,
  salesList: CreditSale[] | null | undefined,
): number {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return 0;
  const ids = new Set(
    (clientsList || [])
      .filter((c) => String(c.name || '').trim().toLowerCase() === key)
      .map((c) => c.id),
  );
  if (!ids.size) return 0;
  return (salesList || []).reduce((sum, sale) => {
    if (!ids.has(String(sale.client_id || ''))) return sum;
    return sum + creditBalance(sale);
  }, 0);
}
