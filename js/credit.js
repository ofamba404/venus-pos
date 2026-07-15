/** Outstanding credit helpers — one client can have many open credit sales. */

export function isOutstandingCredit(sale) {
  return Boolean(sale?.is_credit && !sale.credit_cleared);
}

/** Remaining balance on an open credit sale (UGX). */
export function creditBalance(sale) {
  if (!isOutstandingCredit(sale)) return 0;
  const total = Number(sale.total_ugx) || 0;
  const paid = Math.max(0, Number(sale.amount_paid_ugx) || 0);
  return Math.max(0, total - paid);
}

export function getOutstandingCredit(sales) {
  return (sales || []).filter((s) => creditBalance(s) > 0);
}

export function getClientOutstandingCredit(sales, clientId) {
  if (!clientId) return [];
  return getOutstandingCredit(sales).filter((s) => s.client_id === clientId);
}

export function sumCreditOwed(sales) {
  return (sales || []).reduce((sum, s) => sum + creditBalance(s), 0);
}

/**
 * Split a payment across open credit sales oldest-first (FIFO).
 * Returns [{ sale, applyUgx, newPaid, clears }] for each sale that receives money.
 */
export function allocatePaymentFifo(openSales, amountUgx) {
  let remaining = Math.max(0, Math.round(Number(amountUgx) || 0));
  if (remaining <= 0) return [];

  const sorted = [...(openSales || [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  const allocations = [];
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

/**
 * Group outstanding credit sales by client.
 * Sort: highest total owed first, then name.
 * Within a group, oldest orders first (pay FIFO visibility).
 */
export function groupOutstandingByClient(outstandingSales, clientsList = []) {
  const byKey = new Map();

  for (const sale of outstandingSales) {
    const key = sale.client_id || `unknown-${sale.id}`;
    let group = byKey.get(key);
    if (!group) {
      const client = sale.client_id
        ? clientsList.find((c) => c.id === sale.client_id)
        : null;
      group = {
        key,
        clientId: sale.client_id || '',
        name: client?.name || 'Unknown client',
        sales: [],
        totalUgx: 0,
      };
      byKey.set(key, group);
    }
    group.sales.push(sale);
    group.totalUgx += creditBalance(sale);
  }

  for (const group of byKey.values()) {
    group.sales.sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }

  return [...byKey.values()].sort((a, b) => {
    if (b.totalUgx !== a.totalUgx) return b.totalUgx - a.totalUgx;
    return a.name.localeCompare(b.name);
  });
}
