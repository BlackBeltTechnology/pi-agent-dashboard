/**
 * In-memory worktree-init progress registry.
 *
 * Two delivery keys coexist:
 *   1. `requestId -> WebSocket` (legacy, single ws) — the browser subscribes
 *      via `worktree_init_subscribe { requestId }` BEFORE issuing the run and
 *      the HTTP handler streams `worktree_init_*` events to that one ws.
 *   2. `cwd -> Set<WebSocket>` (durable, fan-out) — every trigger path (manual,
 *      auto-on-spawn, refresh, second tab) subscribes by the run's stable `cwd`
 *      so progress survives a refresh and reaches every tab.
 *
 * A cwd-keyed `Map<cwd, RunState>` tracks in-flight and recently-finished runs;
 * terminal states are retained for a bounded TTL so a boot landing just after
 * done/failed still rehydrates the outcome. `GET /active-inits` reads it.
 *
 * requestId subscriptions auto-expire after `ttlMs`; both subscription kinds
 * drop on WebSocket close.
 *
 * See change: generalize-worktree-init-hook, friendlier-worktree-init.
 */

import type {
  ServerToBrowserMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { WebSocket } from "ws";

const DEFAULT_TTL_MS = 15 * 60 * 1000; // long enough for slow installs
const DEFAULT_TERMINAL_TTL_MS = 60 * 1000; // retention for done/failed run state

/** Server-authoritative per-cwd run state. */
export interface RunState {
  phase: "running" | "done" | "failed";
  startedAt: number;
  /** Drives the ghost preview. */
  lastLine?: string;
  /** Last <= 4KB of combined output; drives the opt-in disclosure. */
  logTail?: string;
  /** Failure classifier (terminal `failed` only). */
  code?: string;
  /** Terminal states only; entry evicted once `Date.now() > expiresAt`. */
  expiresAt?: number;
}

/** Public snapshot shape returned by `getActiveRuns()` / the endpoint. */
export interface ActiveRun {
  cwd: string;
  phase: "running" | "done" | "failed";
  startedAt: number;
  lastLine?: string;
  code?: string;
}

interface Entry {
  ws: WebSocket;
  timer: ReturnType<typeof setTimeout>;
}

export interface WorktreeInitRegistry {
  subscribe(requestId: string, ws: WebSocket): void;
  unsubscribe(requestId: string): void;
  /** Send a message to the subscribed ws, returns true if delivered. */
  send(requestId: string, msg: ServerToBrowserMessage): boolean;
  size(): number;

  // ── cwd-keyed run tracking ───────────────────────────────────────────────
  /** Register/replace a running entry for `cwd`. */
  startRun(cwd: string, startedAt?: number): void;
  /** Update `lastLine` + `logTail` on the running entry (no-op if absent). */
  progressRun(cwd: string, lastLine: string, logTail: string): void;
  /** Transition to a terminal phase with TTL. */
  finishRun(cwd: string, phase: "done" | "failed", code?: string): void;
  /** Running entries + non-expired terminal entries (evicts expired). */
  getActiveRuns(): ActiveRun[];

  // ── cwd-keyed fan-out subscriptions ──────────────────────────────────────
  subscribeCwd(cwd: string, ws: WebSocket): void;
  unsubscribeCwd(cwd: string, ws: WebSocket): void;
  /** Fan out to every ws subscribed by `cwd`; returns delivery count. */
  sendCwd(cwd: string, msg: ServerToBrowserMessage): number;

  dispose(): void;
}

export function createWorktreeInitRegistry(options?: {
  ttlMs?: number;
  terminalTtlMs?: number;
  sendTo?: (ws: WebSocket, msg: ServerToBrowserMessage) => void;
}): WorktreeInitRegistry {
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  const terminalTtlMs = options?.terminalTtlMs ?? DEFAULT_TERMINAL_TTL_MS;
  const sendTo = options?.sendTo ?? defaultSendTo;
  const map = new Map<string, Entry>();
  const runs = new Map<string, RunState>();
  const cwdSubs = new Map<string, Set<WebSocket>>();

  // Track which ws holds which requestIds / cwds so we can drop on disconnect.
  const wsToRequestIds = new WeakMap<WebSocket, Set<string>>();
  const wsToCwds = new WeakMap<WebSocket, Set<string>>();
  const wsCloseBound = new WeakSet<WebSocket>();

  function bindClose(ws: WebSocket) {
    if (wsCloseBound.has(ws)) return;
    wsCloseBound.add(ws);
    ws.once("close", () => {
      const ids = wsToRequestIds.get(ws);
      if (ids) { for (const id of [...ids]) dropEntry(id); }
      const cwds = wsToCwds.get(ws);
      if (cwds) { for (const cwd of [...cwds]) dropCwdSub(cwd, ws); }
    });
  }

  function dropEntry(requestId: string) {
    const entry = map.get(requestId);
    if (!entry) return;
    clearTimeout(entry.timer);
    map.delete(requestId);
    const set = wsToRequestIds.get(entry.ws);
    if (set) { set.delete(requestId); }
  }

  function dropCwdSub(cwd: string, ws: WebSocket) {
    const set = cwdSubs.get(cwd);
    if (set) {
      set.delete(ws);
      if (set.size === 0) cwdSubs.delete(cwd);
    }
    const owned = wsToCwds.get(ws);
    if (owned) owned.delete(cwd);
  }

  /** Evict any terminal run whose TTL has elapsed. */
  function sweepExpired() {
    const now = Date.now();
    for (const [cwd, state] of runs) {
      if (state.expiresAt !== undefined && now > state.expiresAt) runs.delete(cwd);
    }
  }

  return {
    subscribe(requestId, ws) {
      // Replace any prior subscription for the same requestId.
      if (map.has(requestId)) dropEntry(requestId);
      const timer = setTimeout(() => dropEntry(requestId), ttlMs);
      // Allow process to exit naturally even if a subscription is active.
      if (typeof timer.unref === "function") timer.unref();
      map.set(requestId, { ws, timer });
      let set = wsToRequestIds.get(ws);
      if (!set) {
        set = new Set();
        wsToRequestIds.set(ws, set);
      }
      set.add(requestId);
      bindClose(ws);
    },

    unsubscribe(requestId) {
      dropEntry(requestId);
    },

    send(requestId, msg) {
      const entry = map.get(requestId);
      if (!entry) return false;
      try { sendTo(entry.ws, msg); return true; }
      catch { return false; }
    },

    size() { return map.size; },

    startRun(cwd, startedAt) {
      runs.set(cwd, { phase: "running", startedAt: startedAt ?? Date.now() });
    },

    progressRun(cwd, lastLine, logTail) {
      const state = runs.get(cwd);
      if (state?.phase !== "running") return;
      state.lastLine = lastLine;
      state.logTail = logTail;
    },

    finishRun(cwd, phase, code) {
      const prev = runs.get(cwd);
      const now = Date.now();
      runs.set(cwd, {
        phase,
        startedAt: prev?.startedAt ?? now,
        lastLine: prev?.lastLine,
        logTail: prev?.logTail,
        code: phase === "failed" ? code : undefined,
        expiresAt: now + terminalTtlMs,
      });
    },

    getActiveRuns() {
      sweepExpired();
      const out: ActiveRun[] = [];
      for (const [cwd, state] of runs) {
        out.push({
          cwd,
          phase: state.phase,
          startedAt: state.startedAt,
          ...(state.lastLine !== undefined ? { lastLine: state.lastLine } : {}),
          ...(state.code !== undefined ? { code: state.code } : {}),
        });
      }
      return out;
    },

    subscribeCwd(cwd, ws) {
      let set = cwdSubs.get(cwd);
      if (!set) { set = new Set(); cwdSubs.set(cwd, set); }
      set.add(ws);
      let owned = wsToCwds.get(ws);
      if (!owned) { owned = new Set(); wsToCwds.set(ws, owned); }
      owned.add(cwd);
      bindClose(ws);
    },

    unsubscribeCwd(cwd, ws) {
      dropCwdSub(cwd, ws);
    },

    sendCwd(cwd, msg) {
      const set = cwdSubs.get(cwd);
      if (!set || set.size === 0) return 0;
      let delivered = 0;
      for (const ws of set) {
        try { sendTo(ws, msg); delivered++; }
        catch { /* skip a dead ws */ }
      }
      return delivered;
    },

    dispose() {
      for (const requestId of [...map.keys()]) dropEntry(requestId);
      runs.clear();
      cwdSubs.clear();
    },
  };
}

function defaultSendTo(ws: WebSocket, msg: ServerToBrowserMessage): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(msg));
}
