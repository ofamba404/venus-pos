/**
 * Realtime feed: a socket message refetches immediately.
 * If the socket never opens, or it closes, the same refetch runs on a poll.
 * E2E keeps the mock socket open and pushes a frame. The fast poll starts only if connect fails or the socket closes.
 * A slow safety poll always runs beside a live socket: an open socket that never delivers (not joined,
 * token expired, silently dropped on mobile) must not mean a new order goes unnoticed.
 */
export const SAFETY_POLL_MS = 15_000;
export type FeedSocket = {
  close: () => void;
  onClose: (cb: () => void) => void;
  onMessage: (cb: () => void) => void;
};

export function startFeed(opts: {
  connect?: () => FeedSocket | null;
  refetch: () => void;
  pollMs?: number;
}): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const pollMs = opts.pollMs ?? 4000;
  let fast = false;
  const schedule = () => {
    if (stopped || timer) return;
    timer = setTimeout(function tick() {
      timer = null;
      if (stopped) return;
      opts.refetch();
      if (!stopped) timer = setTimeout(tick, fast ? pollMs : SAFETY_POLL_MS);
    }, fast ? pollMs : SAFETY_POLL_MS);
  };

  opts.refetch();
  let socket: FeedSocket | null = null;
  try {
    socket = opts.connect?.() ?? null;
  } catch {
    socket = null;
  }
  if (!socket) {
    fast = true;
    schedule();
  } else {
    schedule();
    socket.onMessage(() => {
      if (!stopped) opts.refetch();
    });
    socket.onClose(() => {
      if (stopped) return;
      fast = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      schedule();
    });
  }

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    try {
      socket?.close();
    } catch {
      /* already closed */
    }
  };
}

export type RealtimeOptions = {
  /** Table to watch. Without it the socket opens but is never joined, so it never delivers. */
  table?: string;
  /** Staff session token. RLS hides store_orders from the anon key, so changes only arrive with it. */
  token?: () => string;
};

export const HEARTBEAT_MS = 25_000;

/** The Phoenix join frame for a postgres_changes subscription (wire format v1). */
export function realtimeJoinFrame(table: string, token: string) {
  return JSON.stringify({
    topic: `realtime:venus-${table}`,
    event: 'phx_join',
    payload: {
      config: {
        broadcast: { ack: false, self: false },
        presence: { key: '' },
        postgres_changes: [{ event: '*', schema: 'public', table }],
      },
      ...(token ? { access_token: token } : {}),
    },
    ref: '1',
  });
}

/** Open the Supabase realtime socket, join the table's changes and keep it alive. Returns null when WebSocket is missing. */
export function connectSupabaseRealtime(url: string, opts: RealtimeOptions = {}): FeedSocket | null {
  if (typeof WebSocket === 'undefined' || !url) return null;
  let ws: WebSocket;
  try {
    ws = new WebSocket(url.includes('vsn=') ? url : `${url}${url.includes('?') ? '&' : '?'}vsn=1.0.0`);
  } catch {
    return null;
  }
  const closeFns: Array<() => void> = [];
  const messageFns: Array<() => void> = [];
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const stopHeartbeat = () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  };
  ws.addEventListener('open', () => {
    try {
      if (opts.table) ws.send(realtimeJoinFrame(opts.table, opts.token?.() || ''));
      heartbeat = setInterval(() => {
        try {
          ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: 'hb' }));
        } catch {
          /* closing */
        }
      }, HEARTBEAT_MS);
    } catch {
      /* closing */
    }
  });
  ws.addEventListener('close', () => {
    stopHeartbeat();
    for (const fn of closeFns) fn();
  });
  ws.addEventListener('error', () => {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  });
  ws.addEventListener('message', (ev: MessageEvent) => {
    let frame: { event?: string; payload?: { status?: string } } | null = null;
    try {
      frame = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    const event = frame?.event;
    if (event === 'postgres_changes') {
      for (const fn of messageFns) fn();
      return;
    }
    // A failed join or a closed channel means no more changes will arrive: drop to the fast poll.
    const failed =
      event === 'phx_error' ||
      event === 'phx_close' ||
      (event === 'phx_reply' && frame?.payload?.status === 'error');
    if (failed) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
  });
  return {
    close: () => ws.close(),
    onClose: (cb) => {
      closeFns.push(cb);
      if (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) cb();
    },
    onMessage: (cb) => messageFns.push(cb),
  };
}
