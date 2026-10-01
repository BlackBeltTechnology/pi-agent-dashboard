/**
 * Browser-socket identity lifetime (openspec §9.4–§9.5 / design D12).
 *
 * Two INDEPENDENT timers, installed per identity-bound browser socket:
 *
 *   §9.4 identity expiry — a one-shot close fired at `principalExpiresAt` (the
 *   underlying token `exp`). When the identity lapses the socket is closed and
 *   its subscriptions released; the client must re-mint an identity ticket to
 *   reconnect. A socket with no `principalExpiresAt` (inert era) gets no expiry
 *   timer.
 *
 *   §9.5 transport heartbeat — a ping/pong liveness probe distinct from the
 *   bridge ping/pong and NOT tied to any single session. A missed pong
 *   terminates the socket. Crucially, a heartbeat NEVER extends identity: the
 *   expiry timer is separate, so a live-but-expired socket still closes on time.
 *
 * Kept as a dependency-injected helper (clock + timer fns) so it is unit
 * testable without a real socket or the whole gateway.
 */

/** Close code for an expired identity (application range). */
export const IDENTITY_EXPIRED_CLOSE_CODE = 4001;

/** Default transport heartbeat interval. */
export const BROWSER_HEARTBEAT_INTERVAL_MS = 30_000;

/** setTimeout caps at a 32-bit delay; a larger delay fires immediately. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** Minimal socket surface the lifetime manager drives. */
export interface LifetimeSocket {
  readonly principalExpiresAt?: number;
  ping(): void;
  terminate(): void;
  close(code?: number, reason?: string): void;
  on(event: "pong", listener: () => void): void;
}

export interface SocketLifetimeOptions {
  heartbeatIntervalMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (h: ReturnType<typeof setTimeout>) => void;
  setHeartbeat?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearHeartbeat?: (h: ReturnType<typeof setInterval>) => void;
}

/**
 * Install the expiry-close (§9.4) and transport-heartbeat (§9.5) timers on a
 * browser socket. Returns a cleanup that clears BOTH timers — call it from the
 * socket's `close`/`error` handler so no timer outlives the socket.
 */
export function installSocketLifetime(ws: LifetimeSocket, opts: SocketLifetimeOptions = {}): () => void {
  const now = opts.now ?? (() => Date.now());
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h));
  const setHeartbeat = opts.setHeartbeat ?? ((fn, ms) => setInterval(fn, ms));
  const clearHeartbeat = opts.clearHeartbeat ?? ((h) => clearInterval(h));
  const intervalMs = opts.heartbeatIntervalMs ?? BROWSER_HEARTBEAT_INTERVAL_MS;

  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  // §9.4 identity expiry — independent of the heartbeat.
  const expiresAt = ws.principalExpiresAt;
  if (typeof expiresAt === "number" && Number.isFinite(expiresAt)) {
    const delay = expiresAt - now();
    if (delay <= 0) {
      ws.close(IDENTITY_EXPIRED_CLOSE_CODE, "identity expired");
    } else if (delay <= MAX_TIMER_DELAY_MS) {
      expiryTimer = setTimer(() => ws.close(IDENTITY_EXPIRED_CLOSE_CODE, "identity expired"), delay);
    }
    // delay > 32-bit cap ⇒ implausible token lifetime; left unscheduled.
  }

  // §9.5 transport heartbeat — a missed pong terminates. Does NOT touch expiry.
  let alive = true;
  ws.on("pong", () => {
    alive = true;
  });
  heartbeatTimer = setHeartbeat(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    ws.ping();
  }, intervalMs);

  return () => {
    if (expiryTimer !== undefined) clearTimer(expiryTimer);
    if (heartbeatTimer !== undefined) clearHeartbeat(heartbeatTimer);
  };
}
