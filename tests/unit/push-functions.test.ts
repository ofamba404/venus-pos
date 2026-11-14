/**
 * Server side of notifications, end to end without touching production:
 * the real Netlify functions run against an in-memory blob store, a stubbed Supabase
 * auth lookup, and a local HTTPS server that plays the browser vendor's push service.
 * The local push service decrypts what it receives, so this proves the message is
 * VAPID-signed and encrypted for the subscription's keys exactly as a phone would need.
 */
import { createServer, type IncomingMessage } from 'node:https';
import { createECDH, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import webpush from 'web-push';
import { subscriptionKey } from '../../netlify/functions/_shared/reminders.mjs';
// @ts-expect-error no types
import ece from 'http_ece';

const blobs = new Map<string, Map<string, unknown>>();
vi.mock('@netlify/blobs', () => ({
  getStore: ({ name }: { name: string }) => {
    if (!blobs.has(name)) blobs.set(name, new Map());
    const m = blobs.get(name)!;
    return {
      async list() {
        return { blobs: [...m.keys()].map((key) => ({ key })) };
      },
      async get(key: string) {
        return m.get(key) ?? null;
      },
      async setJSON(key: string, value: unknown) {
        m.set(key, value);
      },
      async delete(key: string) {
        m.delete(key);
      },
    };
  },
}));

type Received = { headers: IncomingMessage['headers']; body: Buffer; url: string };
let server: ReturnType<typeof createServer>;
let origin = '';
let received: Received[] = [];
let respondWith = 201;
const vapid = webpush.generateVAPIDKeys();

function makeDevice(id: string, extra: Record<string, unknown> = {}) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const authSecret = randomBytes(16);
  const record = {
    endpoint: `${origin}/push/${id}`,
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: authSecret.toString('base64url'),
    },
    ordersEnabled: true,
    schedulesEnabled: false,
    userId: 'user-admin',
    role: 'pos_admin',
    ...extra,
  };
  const decrypt = (body: Buffer) =>
    JSON.parse(
      ece.decrypt(body, { version: 'aes128gcm', privateKey: ecdh, authSecret }).toString('utf8'),
    ) as Record<string, unknown>;
  return { record, decrypt };
}

function put(_id: string, record: Record<string, unknown>) {
  const key = subscriptionKey(String(record.endpoint));
  blobs.get('venus-push')!.set(key, record);
  return key;
}

const users: Record<string, { id: string; role: string }> = {
  'admin-token': { id: 'user-admin', role: 'pos_admin' },
  'staff-token': { id: 'user-staff', role: 'pos_staff' },
};

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'venus-push-'));
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
    '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'),
  ], { stdio: 'ignore' });
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  server = createServer(
    { key: readFileSync(path.join(dir, 'k.pem')), cert: readFileSync(path.join(dir, 'c.pem')) },
    (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        received.push({ headers: req.headers, body: Buffer.concat(chunks), url: req.url || '' });
        res.writeHead(respondWith);
        res.end();
      });
    },
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  blobs.clear();
  blobs.set('venus-push', new Map());
  blobs.set('venus-push-order-alerts', new Map());
  received = [];
  respondWith = 201;
  process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
  process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
  process.env.VAPID_SUBJECT = 'mailto:test@example.com';
  process.env.PUSH_NOTIFY_SECRET = 'test-secret';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
      const token = String(init?.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
      const u = users[token];
      if (!u) return new Response('{}', { status: 401 });
      return new Response(JSON.stringify({ id: u.id, email: 'x@y.z', app_metadata: { role: u.role } }), {
        status: 200,
      });
    }),
  );
});

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://posvenus.netlify.app${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

describe('/api/push/test', () => {
  it('delivers one VAPID-signed, decryptable test push to the caller’s own device', async () => {
    const dev = makeDevice('a');
    put('a', dev.record);
    const { default: handler } = await import('../../netlify/functions/push-test.mjs');
    const res = await handler(post('/api/push/test', { endpoint: dev.record.endpoint }, { authorization: 'Bearer admin-token' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, step: 'sent' });
    expect(received).toHaveLength(1);
    const msg = received[0]!;
    expect(msg.headers['content-encoding']).toBe('aes128gcm');
    expect(msg.headers.authorization).toMatch(/^vapid t=.+, k=.+/);
    expect(msg.headers.authorization).toContain(vapid.publicKey);
    expect(msg.headers.urgency).toBe('high');
    expect(dev.decrypt(msg.body)).toMatchObject({ type: 'test', title: 'Venus test', url: '/next/settings' });
  });

  it('refuses callers who are signed out, other people’s devices and unknown devices', async () => {
    const dev = makeDevice('b');
    put('b', dev.record);
    const { default: handler } = await import('../../netlify/functions/push-test.mjs');
    const call = (token: string, endpoint: string) =>
      handler(post('/api/push/test', { endpoint }, token ? { authorization: `Bearer ${token}` } : {}));
    expect((await call('', dev.record.endpoint)).status).toBe(401);
    expect((await call('staff-token', dev.record.endpoint)).status).toBe(403);
    const unknown = await call('admin-token', `${origin}/push/never-stored`);
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).step).toBe('stored');
    expect(received).toHaveLength(0);
    expect((await handler(post('/api/push/test', {}, { authorization: 'Bearer admin-token' }))).status).toBe(400);
  });

  it('names the cause when the push service refuses, and does not delete the record', async () => {
    const dev = makeDevice('c');
    const key = put('c', dev.record);
    respondWith = 410;
    const { default: handler } = await import('../../netlify/functions/push-test.mjs');
    const res = await handler(post('/api/push/test', { endpoint: dev.record.endpoint }, { authorization: 'Bearer admin-token' }));
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body).toMatchObject({ ok: false, step: 'push-service', status: 410 });
    expect(blobs.get('venus-push')!.has(key)).toBe(true);
    respondWith = 403;
    const refused = await handler(post('/api/push/test', { endpoint: dev.record.endpoint }, { authorization: 'Bearer admin-token' }));
    expect((await refused.json()).error).toContain('403');
  });

  it('reports missing VAPID keys instead of failing silently', async () => {
    const dev = makeDevice('d');
    put('d', dev.record);
    delete process.env.VAPID_PRIVATE_KEY;
    const { default: handler } = await import('../../netlify/functions/push-test.mjs');
    const res = await handler(post('/api/push/test', { endpoint: dev.record.endpoint }, { authorization: 'Bearer admin-token' }));
    expect(res.status).toBe(500);
    expect((await res.json()).step).toBe('vapid');
  });
});

describe('/api/push/notify (the store order alert)', () => {
  it('needs the shared secret', async () => {
    const { default: handler } = await import('../../netlify/functions/push-notify.mjs');
    expect((await handler(post('/api/push/notify', { title: 'x' }))).status).toBe(401);
    expect((await handler(post('/api/push/notify', { title: 'x' }, { 'x-venus-push-secret': 'wrong' }))).status).toBe(401);
  });

  it('sends a new order to admin and staff phones, a review to admins only, and records the dedupe', async () => {
    const admin = makeDevice('admin');
    const staff = makeDevice('staff', { role: 'pos_staff', userId: 'user-staff' });
    const muted = makeDevice('muted', { ordersEnabled: false });
    put('admin', admin.record);
    put('staff', staff.record);
    put('muted', muted.record);
    const { default: handler } = await import('../../netlify/functions/push-notify.mjs');
    const secret = { 'x-venus-push-secret': 'test-secret' };

    const order = await handler(
      post('/api/push/notify', { type: 'storefront-order', title: 'Order placed', body: 'Muza · 2 items', tag: 'storefront-order-ord_1' }, secret),
    );
    expect(await order.json()).toMatchObject({ ok: true, sent: 2, skipped: 1 });
    const byPath = new Map(received.map((r) => [r.url, r]));
    expect(dec(admin, byPath.get('/push/admin')!)).toMatchObject({ title: 'Order placed', orderId: 'ord_1', url: '/#load-store-order=ord_1' });
    expect(dec(staff, byPath.get('/push/staff')!).title).toBe('Order placed');
    expect(byPath.has('/push/muted')).toBe(false);
    expect(blobs.get('venus-push-order-alerts')!.get('order:ord_1')).toMatchObject({ sent: 2, via: 'notify' });

    received = [];
    const review = await handler(post('/api/push/notify', { type: 'store-review', title: 'New review' }, secret));
    expect(await review.json()).toMatchObject({ sent: 1 });
    expect(received.map((r) => r.url)).toEqual(['/push/admin']);
  });

  it('drops a subscription the push service reports gone', async () => {
    const dev = makeDevice('gone');
    const key = put('gone', dev.record);
    respondWith = 410;
    const { default: handler } = await import('../../netlify/functions/push-notify.mjs');
    const res = await handler(post('/api/push/notify', { type: 'store-signup', title: 'Signup' }, { 'x-venus-push-secret': 'test-secret' }));
    expect(await res.json()).toMatchObject({ sent: 0, gone: 1 });
    expect(blobs.get('venus-push')!.has(key)).toBe(false);
  });
});

function dec(dev: ReturnType<typeof makeDevice>, r: Received) {
  return dev.decrypt(r.body);
}
