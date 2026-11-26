/**
 * Hook concurrency limiter (design D7): at most `perTeam` hook children per team and `global`
 * server-wide. A request that cannot start queues INSIDE the caller's deadline; when the deadline
 * passes first it is answered `timeout` (the hook "never started"). `cancelAll()` (shutdown)
 * answers every queued request `shutdown` and refuses new ones.
 * See change: add-agent-teams-templates-hooks.
 */
import type { Clock } from "../shared/clock.js";

export const HOOK_TEAM_CONCURRENCY = 2;
export const HOOK_GLOBAL_CONCURRENCY = 4;

export type HookAcquire = { kind: "slot"; release: () => void } | { kind: "timeout" } | { kind: "shutdown" };

interface Waiter {
  teamId: string;
  deadlineAt: number;
  resolve: (r: HookAcquire) => void;
  timer: unknown;
}

export class HookLimiter {
  private readonly perTeamRunning = new Map<string, number>();
  private globalRunning = 0;
  private waiters: Waiter[] = [];
  private closed = false;

  private readonly clock: Clock;
  private readonly limits: { perTeam: number; global: number };

  constructor(clock: Clock, limits: { perTeam: number; global: number } = { perTeam: HOOK_TEAM_CONCURRENCY, global: HOOK_GLOBAL_CONCURRENCY }) {
    this.clock = clock;
    this.limits = limits;
  }

  /** Currently running slots (probe for tests). */
  get running(): number {
    return this.globalRunning;
  }

  /** Requests waiting for a slot. */
  get queued(): number {
    return this.waiters.length;
  }

  private canRun(teamId: string): boolean {
    return this.globalRunning < this.limits.global && (this.perTeamRunning.get(teamId) ?? 0) < this.limits.perTeam;
  }

  private take(teamId: string): HookAcquire {
    this.globalRunning++;
    this.perTeamRunning.set(teamId, (this.perTeamRunning.get(teamId) ?? 0) + 1);
    let released = false;
    return {
      kind: "slot",
      release: () => {
        if (released) return;
        released = true;
        this.globalRunning--;
        const n = (this.perTeamRunning.get(teamId) ?? 1) - 1;
        if (n <= 0) this.perTeamRunning.delete(teamId);
        else this.perTeamRunning.set(teamId, n);
        this.pump();
      },
    };
  }

  /** Resolve with a slot, or `timeout` when `deadlineAt` (clock ms) passes first. */
  acquire(teamId: string, deadlineAt: number): Promise<HookAcquire> {
    if (this.closed) return Promise.resolve({ kind: "shutdown" });
    const remaining = deadlineAt - this.clock.now();
    if (remaining <= 0) return Promise.resolve({ kind: "timeout" });
    if (this.waiters.length === 0 && this.canRun(teamId)) return Promise.resolve(this.take(teamId));
    return new Promise<HookAcquire>((resolve) => {
      const waiter: Waiter = {
        teamId,
        deadlineAt,
        resolve,
        timer: this.clock.setTimeout(() => {
          this.waiters = this.waiters.filter((w) => w !== waiter);
          resolve({ kind: "timeout" });
        }, remaining),
      };
      this.waiters.push(waiter);
    });
  }

  /** Start every queued request that now fits (first come, first served among the runnable). */
  private pump(): void {
    if (this.closed) return;
    for (const waiter of [...this.waiters]) {
      const expired = this.clock.now() >= waiter.deadlineAt; // its own timer has not fired yet: never start past the deadline
      if (!expired && !this.canRun(waiter.teamId)) continue;
      this.waiters = this.waiters.filter((w) => w !== waiter);
      this.clock.clearTimeout(waiter.timer);
      waiter.resolve(expired ? { kind: "timeout" } : this.take(waiter.teamId));
    }
  }

  /** Shutdown: queued requests never spawn; later requests are refused. */
  cancelAll(): void {
    this.closed = true;
    const pending = this.waiters;
    this.waiters = [];
    for (const w of pending) {
      this.clock.clearTimeout(w.timer);
      w.resolve({ kind: "shutdown" });
    }
  }
}
