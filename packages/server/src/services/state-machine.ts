/**
 * Service lifecycle state machine (D2), its pure decision helpers, the
 * per-service async mutex, and the cross-process `lifecycle.lock` (D1).
 *
 * Lock order (D1): mutex → lifecycle file lock → (briefly, synchronously) the
 * definitions/secrets JSON lock. The JSON locks are never held across an
 * await, so there is no inversion.
 * See change: add-service-registry-core.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type {
  ServiceState,
  UnavailableReason,
} from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";

const _require = createRequire(import.meta.url);
const lockfile = _require("proper-lockfile") as typeof import("proper-lockfile");

// ── Legal edges ─────────────────────────────────────────────────────────────

/** The D2 diagram, edge for edge. */
export const DIAGRAM_EDGES: ReadonlyArray<readonly [ServiceState, ServiceState]> = [
  ["stopped", "starting"],
  ["starting", "healthy"],
  ["starting", "failed"],
  ["starting", "blocked"],
  ["blocked", "healthy"],
  ["healthy", "idle"],
  ["idle", "healthy"],
  ["idle", "blocked"],
  ["idle", "stopping"],
  ["healthy", "blocked"],
  ["stopping", "stopped"],
  ["stopping", "stop-failed"],
  ["stop-failed", "stopping"],
  ["failed", "starting"],
];

/**
 * Edges implied by the spec text around the diagram:
 * - an explicit `stop` acts on a running instance in any live state;
 * - an instance observed gone (exit, `docker rm` by hand) falls to `stopped`;
 * - `unavailable` is derived and re-evaluated on every ensure, so any state may
 *   enter it and it may resolve to any re-evaluated state.
 */
export const EXTRA_EDGES: ReadonlyArray<readonly [ServiceState, ServiceState]> = [
  ["healthy", "stopping"],
  ["blocked", "stopping"],
  ["starting", "stopping"],
  ["healthy", "stopped"],
  ["idle", "stopped"],
  ["blocked", "stopped"],
  ["failed", "stopped"],
  ["stop-failed", "stopped"],
];

const ALL_STATES: readonly ServiceState[] = [
  "stopped", "starting", "healthy", "idle", "stopping", "stop-failed", "blocked", "failed", "unavailable",
];

export function isLegalEdge(from: ServiceState, to: ServiceState): boolean {
  if (from === to) return false;
  if (to === "unavailable" || from === "unavailable") return true;
  return [...DIAGRAM_EDGES, ...EXTRA_EDGES].some(([a, b]) => a === from && b === to);
}

export type TransitionLogger = (line: string) => void;

/**
 * One service's state. Every change is logged as
 * `[services] <id> <from>→<to> reason=…` — the reason is a closed-set token or
 * a short free-text cause, never a secret value. Initialisation by adoption
 * (`init`) is logged too but is not an edge.
 */
export class StateCell {
  state: ServiceState = "stopped";
  reason?: UnavailableReason;

  constructor(
    readonly id: string,
    private readonly log: TransitionLogger,
  ) {}

  init(state: ServiceState, why: string, reason?: UnavailableReason): void {
    const from = this.state;
    this.state = state;
    this.reason = reason;
    this.log(`[services] ${this.id} ${from}→${state} reason=${reason ?? why} (init)`);
  }

  transition(to: ServiceState, why: string, reason?: UnavailableReason): void {
    const from = this.state;
    if (from === to && this.reason === reason) return;
    if (from !== to && !isLegalEdge(from, to)) {
      this.log(`[services] ${this.id} WARNING illegal edge ${from}→${to}`);
    }
    this.state = to;
    this.reason = to === "unavailable" ? reason : undefined;
    this.log(`[services] ${this.id} ${from}→${to} reason=${reason ?? why}`);
  }
}

export { ALL_STATES };

// ── Pure decisions ──────────────────────────────────────────────────────────

export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_CAP_MS = 300_000;

/** Delay before retry after the `failures`-th consecutive failed start (1-based). */
export function backoffMs(failures: number): number {
  const n = Math.max(1, failures);
  return Math.min(BACKOFF_BASE_MS * 2 ** (n - 1), BACKOFF_CAP_MS);
}

export type StartPhase = "healthy" | "failed" | "blocked" | "starting";

/**
 * Outcome of one start-phase observation. A passing probe is the ONLY way to
 * `healthy`; a dead process fails; an alive instance whose probe still fails
 * past `startTimeout` is `blocked`. `alive: "unknown"` (no process matcher)
 * fails at the timeout — it cannot be shown alive.
 */
export function startPhaseOutcome(o: {
  probeOk: boolean;
  alive: boolean | "unknown";
  elapsedMs: number;
  startTimeoutMs: number;
}): StartPhase {
  if (o.probeOk) return "healthy";
  if (o.alive === false) return "failed";
  if (o.elapsedMs > o.startTimeoutMs) return o.alive === true ? "blocked" : "failed";
  return "starting";
}

/** D3 idle-stop rule. */
export function shouldIdleStop(o: {
  state: ServiceState;
  pinned: boolean;
  startedBy: "dashboard" | "external" | undefined;
  hasStopPath: boolean;
  idleStopMinutes: number | null;
  idleSince: number | undefined;
  now: number;
}): boolean {
  if (o.state !== "idle" || o.pinned || o.startedBy !== "dashboard" || !o.hasStopPath) return false;
  if (o.idleStopMinutes === null || o.idleSince === undefined) return false;
  return o.now - o.idleSince >= o.idleStopMinutes * 60_000;
}

// ── Per-service async mutex ─────────────────────────────────────────────────

export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    try {
      return await next;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

// ── Cross-process lifecycle lock ────────────────────────────────────────────

/**
 * `stale` 30 s applies only after the holder died: `update` refreshes the lock
 * mtime while held, so a 46 s first start (spike F:S2.2) is never stolen.
 */
export const LIFECYCLE_LOCK_OPTIONS = { stale: 30_000, update: 10_000 } as const;

export interface LifecycleLockOptions {
  stale?: number;
  update?: number;
  /** How long to wait for another holder. Default 180 s. */
  waitMs?: number;
  pollMs?: number;
}

export class LifecycleLockTimeoutError extends Error {
  readonly code = "lifecycle-lock-timeout";
}

/** Run `fn` holding `<target>.lock` (proper-lockfile, refreshed while held). */
export async function withLifecycleLock<T>(
  target: string,
  fn: () => Promise<T>,
  opts: LifecycleLockOptions = {},
): Promise<T> {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const stale = opts.stale ?? LIFECYCLE_LOCK_OPTIONS.stale;
  const update = opts.update ?? LIFECYCLE_LOCK_OPTIONS.update;
  const deadline = Date.now() + (opts.waitMs ?? 180_000);
  const pollMs = opts.pollMs ?? 200;
  let release: (() => Promise<void>) | undefined;
  for (;;) {
    try {
      release = await lockfile.lock(target, {
        stale,
        update,
        realpath: false,
        lockfilePath: `${target}.lock`,
        onCompromised: (err) => {
          console.warn(`[services] lifecycle lock compromised for ${path.basename(path.dirname(target))} (${(err as { code?: string }).code ?? "unknown"})`);
        },
      });
      break;
    } catch (err) {
      if ((err as { code?: string }).code !== "ELOCKED") throw err;
      if (Date.now() >= deadline) throw new LifecycleLockTimeoutError(`lifecycle lock busy: ${target}`);
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
  try {
    return await fn();
  } finally {
    try {
      await release?.();
    } catch {
      /* already released / compromised */
    }
  }
}
