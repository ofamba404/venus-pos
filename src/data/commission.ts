import { sbFetch } from './api';
import type { Settlement } from '../domain/commission';

/** Payouts recorded against the helper. Admin sees every row. Returns null when it can't be read. */
export async function fetchStaffSettlements(): Promise<Settlement[] | null> {
  try {
    const res = await sbFetch('staff_settlements?select=id,amount_ugx,paid_at,note&order=paid_at.desc&limit=500');
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) ? (rows as Settlement[]) : null;
  } catch {
    return null;
  }
}

export type StaffCommissionSummary = {
  staff_id: string;
  rate?: number;
  earned_all: number;
  paid_all: number;
  pending_credit: number;
  balance: number;
  last_paid_at?: string | null;
};

/** The signed-in staff member's commission row. RLS returns only their own. */
export async function fetchMyCommissionSummary(): Promise<StaffCommissionSummary | null> {
  try {
    const res = await sbFetch(
      'staff_commission_summary?select=staff_id,rate,earned_all,paid_all,pending_credit,balance,last_paid_at&limit=1',
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as StaffCommissionSummary[];
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch {
    return null;
  }
}
