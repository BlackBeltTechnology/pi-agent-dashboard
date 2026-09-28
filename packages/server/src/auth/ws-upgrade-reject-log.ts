/**
 * Rate-limited, secret-free log line for WebSocket upgrade rejections that no
 * other gate logs (bridge-scope 400, auth 401, no-auth 403).
 *
 * Line: `[ws-upgrade] rejected status=<n> scope=<s> peer=<addr>
 * fwd=<comma-names|none> ticket=<present|absent>[ suppressed=<n>]`.
 * Header VALUES, cookies and ticket strings are never read into the line.
 *
 * At most one line per `status|scope|peer` key per window; the first line
 * after a window carries the suppressed count. State is capped at `maxKeys`
 * (expired entries pruned first, then the oldest evicted).
 *
 * One instance per server (no module-global state).
 * See change: harden-ios-safari-memory-and-ws-diagnostics (design D4).
 */
import { forwardingHeaderNamesPresent } from "./localhost-guard.js";

export interface WsUpgradeRejection {
  status: number;
  scope: string;
  remoteAddress: string | undefined;
  headers: Record<string, unknown> | undefined;
  ticketPresent: boolean;
}

export interface WsUpgradeRejectLoggerOptions {
  windowMs?: number;
  maxKeys?: number;
  now?: () => number;
  log?: (line: string) => void;
}

export interface WsUpgradeRejectLogger {
  log(rejection: WsUpgradeRejection): void;
  /** Number of rate-limit keys currently tracked (bounded by `maxKeys`). */
  trackedKeys(): number;
}

export function createWsUpgradeRejectLogger(opts: WsUpgradeRejectLoggerOptions = {}): WsUpgradeRejectLogger {
  const windowMs = opts.windowMs ?? 60_000;
  const maxKeys = opts.maxKeys ?? 256;
  const now = opts.now ?? Date.now;
  const emit = opts.log ?? ((line: string) => console.error(line));
  // Insertion order = age order (entries are re-inserted when their window restarts).
  const state = new Map<string, { windowStart: number; suppressed: number }>();

  function makeRoom(t: number): void {
    for (const [k, v] of state) {
      if (t - v.windowStart >= windowMs) state.delete(k);
    }
    while (state.size >= maxKeys) {
      const oldest = state.keys().next();
      if (oldest.done) break;
      state.delete(oldest.value);
    }
  }

  return {
    log(r) {
      const t = now();
      const peer = r.remoteAddress ?? "unknown";
      const key = `${r.status}|${r.scope}|${peer}`;
      const entry = state.get(key);
      if (entry && t - entry.windowStart < windowMs) {
        entry.suppressed++;
        return;
      }
      const suppressed = entry?.suppressed ?? 0;
      state.delete(key);
      if (state.size >= maxKeys) makeRoom(t);
      state.set(key, { windowStart: t, suppressed: 0 });
      const fwd = forwardingHeaderNamesPresent(r.headers);
      emit(
        `[ws-upgrade] rejected status=${r.status} scope=${r.scope} peer=${peer}` +
          ` fwd=${fwd.length > 0 ? fwd.join(",") : "none"} ticket=${r.ticketPresent ? "present" : "absent"}` +
          (suppressed > 0 ? ` suppressed=${suppressed}` : ""),
      );
    },
    trackedKeys: () => state.size,
  };
}
