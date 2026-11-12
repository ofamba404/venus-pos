/**
 * Realtime feed: a socket message refetches immediately.
 * If the socket never opens, or it closes, the same refetch runs on a poll.
 * E2E keeps the mock socket open and pushes a frame. The poll starts only if connect fails or the socket closes.
 */
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
  const schedule = () => {
    if (stopped || timer) return;
    timer = setTimeout(function tick() {
      timer = null;
      if (stopped) return;
      opts.refetch();
      if (!stopped) timer = setTimeout(tick, pollMs);
    }, pollMs);
  };

  opts.refetch();
  let socket: FeedSocket | null = null;
  try {
    socket = opts.connect?.() ?? null;
  } catch {
    socket = null;
  }
  if (!socket) {
    schedule();
  } else {
    socket.onMessage(() => {
      if (!stopped) opts.refetch();
    });
    socket.onClose(() => {
      if (!stopped) schedule();
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

/** Open the Supabase realtime socket. Returns null when WebSocket is missing. */
export function connectSupabaseRealtime(url: string): FeedSocket | null {
  if (typeof WebSocket === 'undefined' || !url) return null;
  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch {
    return null;
  }
  const closeFns: Array<() => void> = [];
  const messageFns: Array<() => void> = [];
  ws.addEventListener('close', () => {
    for (const fn of closeFns) fn();
  });
  ws.addEventListener('error', () => {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  });
  ws.addEventListener('message', () => {
    for (const fn of messageFns) fn();
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
