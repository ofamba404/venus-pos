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
