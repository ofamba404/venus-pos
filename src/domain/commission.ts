import { ECONOMICS } from './economics';
import { profitPicture, type DecisionSale } from './decisions';
import { historyOrDefault } from './insights-view';
import type { JointCostRow } from './joint-cost';

export type Settlement = { id?: string; amount_ugx?: number | null; paid_at?: string | null; note?: string | null };

export type CommissionLedger = {
  /** Helper's share of profit across every sale on file. An estimate, not a payroll figure. */
  earned: number;
  /** Sum of staff_settlements rows. */
  paid: number;
  /** Earned minus paid, never below zero. */
  owed: number;
  /** How far paid has run past the estimate. Zero when the helper is owed. */
  ahead: number;
  /** The share the estimate uses, as a fraction. */
  share: number;
  lastPaid: { amount: number; at: string } | null;
};

/**
 * What I owe the helper: the 40% estimate (economics.ts) over all sales, minus what
 * staff_settlements says has been paid. All-time on both sides, so a payout always
 * lands against the earnings it was for, whichever period Insights is showing.
 */
export function commissionLedger(
  sales: DecisionSale[] | null | undefined,
  history: JointCostRow[] | null | undefined,
  settlements: Settlement[] | null | undefined,
  share: number = ECONOMICS.helperShare,
): CommissionLedger {
  const earned = profitPicture(sales, historyOrDefault(history), { helperShare: share }).helper;
  const rows = (settlements || []).filter((row) => Number(row.amount_ugx) > 0);
  const paid = rows.reduce((sum, row) => sum + Math.round(Number(row.amount_ugx)), 0);
  const latest = [...rows].sort((a, b) => String(b.paid_at || '').localeCompare(String(a.paid_at || '')))[0];
  return {
    earned,
    paid,
    owed: Math.max(0, earned - paid),
    ahead: Math.max(0, paid - earned),
    share,
    lastPaid: latest ? { amount: Math.round(Number(latest.amount_ugx)), at: String(latest.paid_at || '') } : null,
  };
}
