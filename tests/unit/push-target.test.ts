import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextNotificationPath, orderIdFromPushUrl } from '../../src/domain/push-target';
import { buildPushSubscribeBody, enablePush } from '../../src/data/push';
import { authSession } from '../../src/data/auth';

afterEach(() => {
  vi.unstubAllGlobals();
  authSession.value = null;
});

describe('v2 push targets', () => {
  it('keeps v1 order links inside /next/', () => {
    expect(orderIdFromPushUrl('/#load-store-order=abc%201')).toBe('abc 1');
    expect(
      nextNotificationPath({ url: '/#load-store-order=ord-9', type: 'storefront-order' }),
    ).toBe('/next/orders#order=ord-9');
    expect(nextNotificationPath({ type: 'store-review', url: '/#reviews' })).toBe('/next/reviews');
    expect(nextNotificationPath({ url: '/#store-orders' })).toBe('/next/orders');
    expect(orderIdFromPushUrl('')).toBe('');
    expect(nextNotificationPath({ orderId: 'plain-id' })).toBe('/next/orders#order=plain-id');
    expect(nextNotificationPath({ url: '/pages/reviews.html' })).toBe('/next/reviews');
  });

  it('posts the same subscribe body v1 sends', () => {
    expect(
      buildPushSubscribeBody({ endpoint: 'https://push.example', keys: { p256dh: 'a', auth: 'b' } }, {
        orders: true,
      }),
    ).toEqual({
      subscription: { endpoint: 'https://push.example', keys: { p256dh: 'a', auth: 'b' } },
      schedulesEnabled: false,
      ordersEnabled: true,
    });
  });

  it('registers only the /next worker and posts the subscription', async () => {
    expect(await enablePush({ orders: true })).toEqual({ ok: false, reason: 'unsupported' });
    authSession.value = { access_token: 'staff-token' };
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: async () => 'granted' });
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('navigator', {
      serviceWorker: {
        register: async () => ({
          pushManager: {
            getSubscription: async () => null,
            subscribe: async () => ({
              toJSON: () => ({ endpoint: 'https://push.example/1', keys: { p256dh: 'aa', auth: 'bb' } }),
            }),
          },
        }),
      },
    });
    expect(await enablePush({ orders: true })).toEqual({ ok: true, reason: 'granted' });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/push/subscribe');
  });
});