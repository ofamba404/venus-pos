/** Body for `POST /api/push/subscribe`, same fields as legacy `subscribeWebPush`. */
export function buildPushSubscribeBody(
  subscription: { endpoint?: string; keys?: Record<string, string> } | null,
  prefs: { orders?: boolean; schedules?: boolean },
) {
  return {
    subscription,
    schedulesEnabled: Boolean(prefs.schedules),
    ordersEnabled: Boolean(prefs.orders),
  };
}
