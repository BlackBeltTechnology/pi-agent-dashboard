/**
 * Bridge half of the reserve-path pair (D9). The server decides (control tier, a tier-5 viewer, bounds); this link only
 * sends `preview_path_request`, validates the shape of the answer and forwards it. The in-process seam is the neutral
 * `mock-site:base-reservation` event `{port, pending, signal}`: `pi.events.emit` is synchronous fire-and-forget, so the
 * FIRST listener sets `probe.pending` synchronously and later listeners must not overwrite it.
 * An aborted probe whose reservation exists (or may exist) is released with ONE `preview_path_release`.
 * See change: serve-live-previews-on-capability-origin (D9).
 */
import { randomUUID } from "node:crypto";

const REQUEST_TIMEOUT_MS = 10_000;
/** The only shape a reserved base may have: `/preview/<22-char pid>/`. Anything else is a malformed answer. */
const BASE_SHAPE = /^\/preview\/[A-Za-z0-9_-]{22}\/$/;

export interface BaseReservation {
  base: string;
}

export interface PreviewPathLinkDeps {
  /** Sends on the OPEN socket; `false` = not sent. */
  send: (msg: unknown) => boolean;
  sessionId: () => string;
  timeoutMs?: number;
  newId?: () => string;
}

export interface PreviewPathLink {
  request(port: number, signal?: AbortSignal): Promise<BaseReservation | null>;
  /** Consumes a `preview_path_result` frame. Returns true when it was one. */
  handleResult(msg: { type?: string; requestId?: unknown; path?: unknown; error?: unknown }): boolean;
  /** Socket closed: pending requests settle as "no reservation" (the server dropped this connection's reservations). */
  reset(): void;
}

interface Pending {
  settle: (r: BaseReservation | null, err?: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  aborted: boolean;
  released: boolean;
}

export function createPreviewPathLink(deps: PreviewPathLinkDeps): PreviewPathLink {
  const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const newId = deps.newId ?? randomUUID;
  const pending = new Map<string, Pending>();

  const release = (requestId: string, p: Pending): void => {
    if (p.released) return;
    p.released = true;
    try {
      deps.send({ type: "preview_path_release", requestId, sessionId: deps.sessionId() });
    } catch {
      /* the server drops this connection's reservations on close anyway */
    }
  };

  return {
    request(port, signal) {
      return new Promise<BaseReservation | null>((resolve, reject) => {
        const requestId = newId();
        const entry: Pending = {
          timer: setTimeout(() => {
            // No answer: the server may still have reserved — drop it by id (idempotent), then give up.
            pending.delete(requestId);
            release(requestId, entry);
            resolve(null);
          }, timeoutMs),
          aborted: false,
          released: false,
          settle: (r, err) => (err ? reject(err) : resolve(r)),
        };
        entry.timer.unref?.();
        pending.set(requestId, entry);
        signal?.addEventListener(
          "abort",
          () => {
            entry.aborted = true;
            // Already answered (entry gone): the reservation exists → release it now. Still in flight: release on arrival.
            if (!pending.has(requestId)) release(requestId, entry);
          },
          { once: true },
        );
        let sent = false;
        try {
          sent = deps.send({ type: "preview_path_request", requestId, sessionId: deps.sessionId(), port });
        } catch {
          sent = false;
        }
        if (!sent) {
          clearTimeout(entry.timer);
          pending.delete(requestId);
          resolve(null);
        }
      });
    },
    handleResult(msg) {
      if (msg?.type !== "preview_path_result") return false;
      if (typeof msg.requestId !== "string") return true;
      const entry = pending.get(msg.requestId);
      if (!entry) return true; // unknown / duplicate / late-after-timeout: ignored
      pending.delete(msg.requestId);
      clearTimeout(entry.timer);
      const path = msg.path;
      if (path !== null && (typeof path !== "string" || !BASE_SHAPE.test(path))) {
        entry.settle(null, new Error("base reservation unavailable: malformed answer"));
        return true;
      }
      if (entry.aborted) {
        if (path !== null) release(msg.requestId, entry); // a late reservation: drop it so the root-started site is never adopted
        entry.settle(null);
        return true;
      }
      if (typeof msg.error === "string") {
        entry.settle(null, new Error(`base reservation unavailable: ${msg.error}`));
        return true;
      }
      entry.settle(path === null ? null : { base: path });
      return true;
    },
    reset() {
      for (const [id, e] of [...pending]) {
        pending.delete(id);
        clearTimeout(e.timer);
        e.settle(null);
      }
    },
  };
}

/** Probe payload of `mock-site:base-reservation` (owned by the mockup-loop package; no import dependency). */
interface BaseReservationProbe {
  port?: unknown;
  pending?: Promise<BaseReservation | null>;
  signal?: AbortSignal;
}

/** Subscribe the link to the neutral probe event. First listener wins; a probe with a bad port is ignored. */
export function installBaseReservationListener(
  events: { on: (channel: string, handler: (data: unknown) => void) => (() => void) | void },
  link: () => PreviewPathLink | undefined,
): () => void {
  const off = events.on("mock-site:base-reservation", (data) => {
    const probe = data as BaseReservationProbe | null;
    if (!probe || typeof probe !== "object" || probe.pending !== undefined) return;
    if (typeof probe.port !== "number" || !Number.isInteger(probe.port)) return;
    const l = link();
    if (!l) return;
    probe.pending = l.request(probe.port, probe.signal);
  });
  return typeof off === "function" ? off : () => {};
}
