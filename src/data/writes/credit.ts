import { sbFetch } from '../api';

export function postCreditPayment(body: {
  client_id: string;
  amount_ugx: number;
  method: string;
  note: string | null;
}) {
  return sbFetch('credit_payments', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
