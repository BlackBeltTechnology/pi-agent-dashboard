// Ported from InvoiceBot `src/reconnecting-socket.ts`
// (BlackBeltTechnology/invoice-bot-dashboard); option shape kept compatible with
// its call sites (change: extract-standalone-app-kit, design D7).
//
// Framework-agnostic reconnecting WebSocket controller. A proxy/load balancer
// with an idle timeout silently reaps a quiet socket; without reconnect a live
// view goes deaf. This controller distinguishes an UNEXPECTED close/error
// (→ bounded backoff reconnect) from an INTENTIONAL teardown (`close()` → no
// reconnect), and caps retries so a genuine outage surfaces as "disconnected".
//
// `resolveUrl` runs before EVERY attempt, so each (re)connect carries a fresh
// single-use WS ticket. `maxRetries` counts retries after the first attempt
// (cap 3 ⇒ at most 4 attempts, then terminal `disconnected`). A resolver that
// returns `null` or rejects ends the loop immediately: without a credential,
// retrying cannot help. It owns ONLY the socket lifecycle: `onOpen` re-runs on
// every (re)connect (re-subscribe there) and raw messages go to `onMessage`.

/** Minimal WebSocket surface — real `WebSocket` satisfies it; tests inject a fake. */
export interface MinimalSocket {
  send(data: string): void;
  close(): void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
}

export type ReconnectStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface ReconnectOptions {
  url: string;
  /**
   * Resolve the URL to actually open — the single seam that mints a fresh
   * single-use WS ticket per (re)connect. May be synchronous or asynchronous.
   * Returning `null` means "do NOT open" (no live credential): the controller
   * reports `disconnected` and opens nothing. Defaults to `() => url`.
   */
  resolveUrl?: () => string | null | Promise<string | null>;
  /** Status transitions: connecting → connected; on unexpected loss → reconnecting → (connected | disconnected). */
  onStatus: (status: ReconnectStatus) => void;
  /** Called on every (re)open with a send fn — the caller re-sends `subscribe` here. */
  onOpen: (send: (data: string) => void) => void;
  /** Raw message payload from the socket (JSON string); the caller parses + folds. */
  onMessage: (data: unknown) => void;
  /** Socket factory for tests; defaults to the platform `WebSocket`. */
  createSocket?: (url: string) => MinimalSocket;
  /** Timer injection for deterministic tests. */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (h: ReturnType<typeof setTimeout>) => void;
  /** Jitter source for deterministic tests. */
  random?: () => number;
  /** Retry cap; once exhausted the status becomes terminal "disconnected". */
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Fraction of the exponential delay added as random jitter (default 0.5). */
  jitterRatio?: number;
}

export interface ReconnectHandle {
  /** Send on the current socket if present (no-op / swallowed when not open). */
  send(data: string): void;
  /** Intentional teardown: stops reconnect, closes the socket, emits "disconnected". */
  close(): void;
}

const DEFAULT_MAX_RETRIES = 6;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 15_000;
const DEFAULT_JITTER_RATIO = 0.5;

/**
 * Open `url` and keep it open across unexpected closes with bounded exponential
 * backoff + jitter. `onOpen` re-runs on every (re)connect so the caller can
 * re-`subscribe`. Call `close()` for intentional teardown — it never reconnects.
 */
export function connectWithReconnect(opts: ReconnectOptions): ReconnectHandle {
  const {
    url,
    resolveUrl = () => url,
    onStatus,
    onOpen,
    onMessage,
    createSocket = (u: string) => new WebSocket(u) as unknown as MinimalSocket,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (h) => clearTimeout(h),
    random = Math.random,
    maxRetries = DEFAULT_MAX_RETRIES,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    jitterRatio = DEFAULT_JITTER_RATIO,
  } = opts;

  let socket: MinimalSocket | null = null;
  let tornDown = false;
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const backoff = (attempt: number): number => {
    const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
    return exp + random() * exp * jitterRatio;
  };

  const detach = (s: MinimalSocket | null) => {
    if (s) s.onopen = s.onmessage = s.onclose = s.onerror = null;
  };

  const scheduleReconnect = () => {
    if (tornDown) return;
    // Drop the dead socket's handlers so a paired close-after-error can't
    // double-schedule, and close it: after an `error` the connection may still
    // be open, and `send()` must never target a socket we gave up on.
    const dead = socket;
    detach(dead);
    socket = null;
    try {
      dead?.close();
    } catch {
      /* already closing */
    }
    if (attempts >= maxRetries) {
      onStatus("disconnected");
      return;
    }
    onStatus("reconnecting");
    const delay = backoff(attempts);
    attempts += 1;
    timer = setTimer(connect, delay);
  };

  function open(urlToOpen: string) {
    if (tornDown) return;
    let s: MinimalSocket;
    try {
      s = createSocket(urlToOpen);
    } catch {
      // An invalid URL / unsupported scheme: retrying the same URL cannot help.
      onStatus("disconnected");
      return;
    }
    socket = s;
    s.onopen = () => {
      if (tornDown) return;
      attempts = 0; // a clean open resets the backoff window
      onStatus("connected");
      onOpen((data: string) => {
        try {
          s.send(data);
        } catch {
          /* not open yet / already closing */
        }
      });
    };
    s.onmessage = (ev: { data: unknown }) => {
      if (!tornDown) onMessage(ev.data);
    };
    s.onclose = () => {
      if (!tornDown) scheduleReconnect();
    };
    s.onerror = () => {
      if (!tornDown) scheduleReconnect();
    };
  }

  function connect() {
    if (tornDown) return;
    timer = null;
    let resolved: string | null | Promise<string | null>;
    try {
      resolved = resolveUrl();
    } catch {
      onStatus("disconnected");
      return;
    }
    if (typeof resolved === "string") {
      open(resolved);
      return;
    }
    if (resolved === null) {
      // No live credential — never open a socket without one.
      onStatus("disconnected");
      return;
    }
    void resolved.then(
      (u) => {
        if (tornDown) return;
        if (u === null) onStatus("disconnected");
        else open(u);
      },
      () => {
        if (!tornDown) onStatus("disconnected");
      },
    );
  }

  onStatus("connecting");
  connect();

  return {
    send(data: string) {
      if (tornDown || !socket) return;
      try {
        socket.send(data);
      } catch {
        /* not open — dropped */
      }
    },
    close() {
      if (tornDown) return;
      tornDown = true;
      if (timer) {
        clearTimer(timer);
        timer = null;
      }
      const s = socket;
      detach(s);
      try {
        s?.close();
      } catch {
        /* ignore */
      }
      socket = null;
      onStatus("disconnected");
    },
  };
}
