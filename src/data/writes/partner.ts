import { peekAccessToken } from '../auth';

/** Same POST the insights page used: local qty is already saved; this call can fail. */
export function postCookiePartnerSettle(settledQty: number) {
  return fetch('/api/cookie-partner/settle', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${peekAccessToken()}`,
    },
    body: JSON.stringify({ settled_qty: settledQty }),
  });
}
