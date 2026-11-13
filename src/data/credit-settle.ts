import { allocatePaymentFifo, creditBalance, sumCreditOwed, type CreditSale } from '../domain/credit';
import { postCreditPayment } from './writes/credit';
import { patchSale } from './writes/sales';

/** Settling is amount plus an optional note. The payment row still carries the column the schema expects. */
export const SETTLE_DEFAULT_METHOD = 'cash';

export type SettleResult = { ok: true; paid: number } | { ok: false; error: string };

/**
 * Take a payment against open credit sales, oldest first. The Clients page and Insights both use this,
 * so a settle is the same write wherever it starts. Pass one sale to settle one order.
 */
export async function settleCredit(input: {
  openSales: CreditSale[];
  clientId?: string | null;
  amount: number;
  note?: string | null;
}): Promise<SettleResult> {
  const owed = sumCreditOwed(input.openSales);
  const pay = Math.min(owed, Math.max(0, Math.round(Number(input.amount) || 0)));
  if (owed <= 0) return { ok: false, error: 'Nothing owed' };
  if (pay <= 0) return { ok: false, error: 'Enter an amount' };
  try {
    const open = input.openSales.filter((s) => creditBalance(s) > 0);
    for (const row of allocatePaymentFifo(open, pay)) {
      if (!row.sale.id) continue;
      const res = await patchSale(row.sale.id, {
        amount_paid_ugx: row.newPaid,
        credit_cleared: row.clears,
        ...(row.clears ? { cleared_at: new Date().toISOString() } : {}),
      });
      if (!res.ok) return { ok: false, error: `Could not update sale (${res.status})` };
    }
    if (input.clientId) {
      await postCreditPayment({
        client_id: input.clientId,
        amount_ugx: pay,
        method: SETTLE_DEFAULT_METHOD,
        note: input.note?.trim() || null,
      }).catch(() => {});
    }
    return { ok: true, paid: pay };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Settle failed' };
  }
}
