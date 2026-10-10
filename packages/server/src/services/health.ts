/**
 * Health probes (D6, D10): `http` (2xx), `tcp` (connect), `ws-first-message`
 * (open + one frame within the timeout, WITHOUT any authentication), and
 * `oci-healthcheck` (delegated to the OCI driver). All async and bounded; a
 * global limiter caps in-flight probes at 4 so a fleet of stalled services
 * cannot saturate the server event loop.
 * See change: add-service-registry-core.
 */
import net from "node:net";
import WebSocket from "ws";

export const PROBE_CONCURRENCY = 4;
const DEFAULT_PROBE_TIMEOUT_MS = 3_000;

export async function probeHttp(url: string, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
    await res.body?.cancel().catch(() => {});
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}

export function probeTcp(url: string, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      resolve(false);
      return;
    }
    const socket = net.connect({ host: u.hostname.replace(/^\[|\]$/g, ""), port: Number(u.port) });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/** Open, wait for ONE frame, close. Sends nothing — no auth, no hello. */
export function probeWsFirstMessage(url: string, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url, { handshakeTimeout: timeoutMs });
    } catch {
      resolve(false);
      return;
    }
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.removeAllListeners();
      ws.on("error", () => {});
      ws.terminate();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    ws.once("message", () => done(true));
    ws.once("error", () => done(false));
    ws.once("close", () => done(false));
  });
}

/** Concurrency limiter: at most `max` `fn`s in flight; the rest queue FIFO. */
export function createLimiter(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= max) return;
    const start = queue.shift();
    if (start) start();
  };
  return <T>(fn: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        active++;
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
}
