import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  connectSupabaseRealtime,
  HEARTBEAT_MS,
  realtimeJoinFrame,
  SAFETY_POLL_MS,
  startFeed,
  type FeedSocket,
} from '../../src/data/realtime';

class FakeSocket {
  static last: FakeSocket;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = 1;
  sent: string[] = [];
  url: string;
  listeners: Record<string, Array<(e: unknown) => void>> = {};
  constructor(url: string) {
    this.url = url;
    FakeSocket.last = this;
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    (this.listeners[type] ||= []).push(fn);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.emit('close', {});
  }
  emit(type: string, e: unknown) {
    for (const fn of this.listeners[type] || []) fn(e);
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('realtime socket', () => {
  it('joins the table with the staff token, heartbeats, and only reports row changes', () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    const socket = connectSupabaseRealtime('wss://x.supabase.co/realtime/v1/websocket?apikey=k', {
      table: 'store_orders',
      token: () => 'staff-jwt',
    })!;
    const ws = FakeSocket.last;
    expect(ws.url).toBe('wss://x.supabase.co/realtime/v1/websocket?apikey=k&vsn=1.0.0');
    ws.emit('open', {});
    const join = JSON.parse(ws.sent[0]!);
    expect(join).toMatchObject({
      topic: 'realtime:venus-store_orders',
      event: 'phx_join',
      payload: { access_token: 'staff-jwt', config: { postgres_changes: [{ event: '*', schema: 'public', table: 'store_orders' }] } },
    });
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect(JSON.parse(ws.sent[1]!)).toMatchObject({ topic: 'phoenix', event: 'heartbeat' });

    let changes = 0;
    socket.onMessage(() => (changes += 1));
    ws.emit('message', { data: JSON.stringify({ event: 'phx_reply', payload: { status: 'ok' } }) });
    ws.emit('message', { data: 'not json' });
    expect(changes).toBe(0);
    ws.emit('message', { data: JSON.stringify({ event: 'postgres_changes', payload: {} }) });
    expect(changes).toBe(1);
  });

  it('drops to the fast poll when the join fails or the channel closes', () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const socket = connectSupabaseRealtime('wss://x/y', { table: 't' })!;
    let closed = 0;
    socket.onClose(() => (closed += 1));
    FakeSocket.last.emit('message', { data: JSON.stringify({ event: 'phx_reply', payload: { status: 'error' } }) });
    expect(closed).toBe(1);
    const again = connectSupabaseRealtime('wss://x/y?vsn=2.0.0')!;
    FakeSocket.last.emit('open', {}); // no table: nothing to join
    expect(FakeSocket.last.sent).toEqual([]);
    FakeSocket.last.emit('message', { data: JSON.stringify({ event: 'phx_error' }) });
    let late = 0;
    again.onClose(() => (late += 1)); // already closed: fires at once
    expect(late).toBe(1);
    again.close();
    FakeSocket.last.emit('error', {});
  });

  it('builds a join frame without a token for anonymous sessions', () => {
    expect(JSON.parse(realtimeJoinFrame('t', '')).payload.access_token).toBeUndefined();
  });

  it('keeps a slow safety poll beside a live socket, and goes fast once it closes', () => {
    vi.useFakeTimers();
    let refetch = 0;
    let closeCb = () => {};
    const socket: FeedSocket = { close: () => {}, onClose: (cb) => (closeCb = cb), onMessage: () => {} };
    const stop = startFeed({ connect: () => socket, refetch: () => (refetch += 1), pollMs: 4000 });
    expect(refetch).toBe(1);
    vi.advanceTimersByTime(4000 * 3);
    expect(refetch).toBe(1); // quiet socket: no fast poll
    vi.advanceTimersByTime(SAFETY_POLL_MS);
    expect(refetch).toBe(2); // but a silently dead socket cannot hide an order
    closeCb();
    vi.advanceTimersByTime(4000);
    expect(refetch).toBe(3);
    stop();
    vi.advanceTimersByTime(60_000);
    expect(refetch).toBe(3);
  });

  it('polls fast when no socket can be opened', () => {
    vi.useFakeTimers();
    let refetch = 0;
    const stop = startFeed({ connect: () => null, refetch: () => (refetch += 1), pollMs: 4000 });
    vi.advanceTimersByTime(8000);
    expect(refetch).toBe(3);
    stop();
  });
});
