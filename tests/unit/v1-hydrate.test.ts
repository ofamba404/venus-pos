/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { authRole, hydrateAuth, readStoredSession } from '../../src/data/auth';
import { readStoredCart } from '../../src/data/session-cart';
import { buildPushSubscribeBody } from '../../src/data/push';
import { startFeed, type FeedSocket } from '../../src/data/realtime';

describe('v1 session and cart hydrate', () => {
  it('accepts a v1 venus-pos-auth session wrapped as currentSession', () => {
    localStorage.setItem(
      'venus-pos-auth',
      JSON.stringify({
        currentSession: {
          access_token: 'header.payload.sig',
          refresh_token: 'refresh-v1',
          user: { email: 'owner@venus.test', app_metadata: { role: 'pos_admin' } },
        },
      }),
    );
    const session = readStoredSession();
    expect(session?.access_token).toBe('header.payload.sig');
    hydrateAuth();
    expect(authRole.value).toBe('pos_admin');
  });

  it('reads a v1 cart and order meta from sessionStorage', () => {
    sessionStorage.setItem(
      'venus-pos-cart',
      JSON.stringify([
        {
          key: 'line-1',
          productId: 'scout',
          name: 'Scout Pack',
          detail: 'Mint',
          breakdown: { mint: 1 },
          lineTotal: 8000,
        },
      ]),
    );
    sessionStorage.setItem(
      'venus-pos-order-meta',
      JSON.stringify({ clientName: 'Test Client A', clientId: 'client-a', isCredit: false }),
    );
    const stored = readStoredCart();
    expect(stored.lines).toHaveLength(1);
    expect(stored.lines[0]?.lineTotal).toBe(8000);
    expect(stored.meta.clientName).toBe('Test Client A');
    expect(stored.meta.clientId).toBe('client-a');
    expect(stored.meta.deliveryEnabled).toBe(true);
  });
});

describe('push subscribe body', () => {
  it('matches the legacy subscribe fields', () => {
    expect(
      buildPushSubscribeBody({ endpoint: 'https://push.example/1', keys: { p256dh: 'a', auth: 'b' } }, {
        orders: true,
        schedules: false,
      }),
    ).toEqual({
      subscription: { endpoint: 'https://push.example/1', keys: { p256dh: 'a', auth: 'b' } },
      schedulesEnabled: false,
      ordersEnabled: true,
    });
  });
});

describe('realtime feed', () => {
  it('refetches when the socket messages, and polls after the socket closes', () => {
    let refetch = 0;
    let closeCb = () => {};
    let messageCb = () => {};
    const socket: FeedSocket = {
      close: () => {},
      onClose: (cb) => {
        closeCb = cb;
      },
      onMessage: (cb) => {
        messageCb = cb;
      },
    };
    const stop = startFeed({
      connect: () => socket,
      refetch: () => {
        refetch += 1;
      },
      pollMs: 4000,
    });
    expect(refetch).toBe(1);
    messageCb();
    expect(refetch).toBe(2);
    closeCb();
    stop();
  });
});
