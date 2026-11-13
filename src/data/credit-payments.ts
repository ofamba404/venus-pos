import { sbFetch } from './api';
import type { CreditPayment } from '../domain/credit-book';

/** Recent credit payments, newest first. Null when they cannot be read, so the card says nothing rather than 0. */
export async function fetchCreditPayments(): Promise<CreditPayment[] | null> {
  try {
    const res = await sbFetch('credit_payments?select=client_id,amount_ugx,created_at&order=created_at.desc&limit=2000');
    if (!res.ok) return null;
    const rows = (await res.json()) as CreditPayment[];
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}
