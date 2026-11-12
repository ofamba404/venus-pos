/** Where a v2 notification click should land. v1 paths stay on the root worker. */

export function orderIdFromPushUrl(url: string | null | undefined): string {
  const match = String(url || '').match(/load-store-order=([^&#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

export function nextNotificationPath(data: {
  url?: string;
  orderId?: string;
  type?: string;
}): string {
  const orderId = data.orderId || orderIdFromPushUrl(data.url);
  if (data.type === 'store-review' || /review/.test(String(data.url || ''))) return '/next/reviews';
  if (orderId) return `/next/sell#load-store-order=${encodeURIComponent(orderId)}`;
  return '/next/orders';
}
