/**
 * Idle disconnect sweep (change: add-dedicated-agent-browser, D8 / task 6.3).
 *
 * A 60 s interval closes instances idle LONGER than `idleDisconnectMinutes`
 * (0 = off). Activity is injected (`activityOf`: last client-originated CDP
 * command or viewer input); a pending `browser_await_human` holds the instance
 * (and restarts the idle clock when it ends). The sweep is a no-op while the
 * plugin is disabled (the kill switch closes everything itself) and re-checks
 * `isRegistered` right before closing. After a successful `close(id, "idle")`
 * the sweeper appends `detach` with detail `idle` — `close` must NOT audit it.
 */
import type { AuditRing } from "./audit.js";

const IDLE_SWEEP_INTERVAL_MS = 60_000;

export interface IdleSweepTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const REAL_TIMERS: IdleSweepTimers = {
  setInterval: (fn, ms) => {
    const h = setInterval(fn, ms);
    h.unref?.(); // never keep the server alive
    return h;
  },
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

export interface IdleSweepDeps {
  /** Plugin (kill switch) enabled. */
  enabled(): boolean;
  /** 0 = off. */
  idleMinutes(): number;
  /** Live relay + dedicated instances. */
  instances(): Array<{ instanceId: string; profileDirectory: string }>;
  /** Epoch ms of the last client command / viewer input; `undefined` = none recorded. */
  activityOf(instanceId: string): number | undefined;
  /** A `browser_await_human` for the instance is pending. */
  awaitPending(instanceId: string): boolean;
  isRegistered(instanceId: string): boolean;
  /** Relay → `RelayManager.disconnect`; dedicated → client-close rule. Must not append the audit. */
  close(instanceId: string, reason: "idle"): void;
  audit: Pick<AuditRing, "append">;
  now?: () => number;
  timers?: IdleSweepTimers;
}

export class IdleSweeper {
  private readonly deps: IdleSweepDeps;
  private readonly now: () => number;
  private readonly timers: IdleSweepTimers;
  private handle: unknown;
  /** First-seen fallback for instances without recorded activity. */
  private readonly seen = new Map<string, number>();
  /** Last sweep at which an await was pending. */
  private readonly held = new Map<string, number>();

  constructor(deps: IdleSweepDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
    this.timers = deps.timers ?? REAL_TIMERS;
  }

  /** Instances with bookkeeping (pruned each sweep). */
  get trackedSize(): number {
    return this.seen.size;
  }

  start(): void {
    if (this.handle !== undefined) return;
    this.handle = this.timers.setInterval(() => this.sweep(), IDLE_SWEEP_INTERVAL_MS);
  }

  stop(): void {
    if (this.handle === undefined) return;
    this.timers.clearInterval(this.handle);
    this.handle = undefined;
  }

  sweep(): void {
    const d = this.deps;
    if (!d.enabled()) return;
    const t = this.now();
    const live = d.instances();
    this.prune(new Set(live.map((i) => i.instanceId)));
    const limit = d.idleMinutes() * 60_000;
    for (const instance of live) this.sweepOne(instance, t, limit);
  }

  /** Drop bookkeeping for instances that are no longer live. */
  private prune(liveIds: ReadonlySet<string>): void {
    for (const m of [this.seen, this.held]) for (const id of [...m.keys()]) if (!liveIds.has(id)) m.delete(id);
  }

  /** Record activity bookkeeping for one instance and close it when idle past `limit`. */
  private sweepOne({ instanceId, profileDirectory }: { instanceId: string; profileDirectory: string }, t: number, limit: number): void {
    const d = this.deps;
    if (!this.seen.has(instanceId)) this.seen.set(instanceId, t);
    if (d.awaitPending(instanceId)) this.held.set(instanceId, t);
    if (limit <= 0) return;
    const last = Math.max(d.activityOf(instanceId) ?? this.seen.get(instanceId)!, this.held.get(instanceId) ?? 0);
    if (t - last <= limit) return;
    if (!d.isRegistered(instanceId)) return;
    try {
      d.close(instanceId, "idle");
    } catch {
      return; // one failing close must not stop the sweep
    }
    d.audit.append({ profileDirectory, instanceId, kind: "detach", detail: "idle" });
    this.seen.delete(instanceId);
    this.held.delete(instanceId);
  }
}
