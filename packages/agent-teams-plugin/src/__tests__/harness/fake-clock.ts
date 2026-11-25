/**
 * Deterministic `Clock` for L1 tests. Time only moves through `advance*`; timers
 * fire in (due time, creation order) and a timer scheduled by a firing timer is
 * honoured when it falls inside the advanced window. Boundary tests ("fires at
 * 9999 / 10000 ms") are exact because nothing depends on wall time.
 * See change: add-agent-teams-core (test-plan: injected clock).
 */
import type { Clock } from "../../shared/clock.js";

interface PendingTimer {
  readonly id: number;
  readonly due: number;
  readonly fn: () => void;
}

export class FakeClock implements Clock {
  private current: number;
  private seq = 0;
  private readonly timers = new Map<number, PendingTimer>();

  constructor(startMs = 0) {
    this.current = startMs;
  }

  now(): number {
    return this.current;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.set(id, { id, due: this.current + Math.max(0, ms), fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  /** Number of timers that have not fired and were not cleared. */
  get pendingCount(): number {
    return this.timers.size;
  }

  /** Due time of the next timer, or `undefined` when none is pending. */
  nextDue(): number | undefined {
    let min: number | undefined;
    for (const t of this.timers.values()) if (min === undefined || t.due < min) min = t.due;
    return min;
  }

  /** Move time forward by `ms`, firing due timers synchronously in order. */
  advance(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      const next = this.takeNextDue(target);
      if (!next) break;
      this.current = next.due;
      next.fn();
    }
    this.current = target;
  }

  /**
   * Like `advance`, but yields to the microtask queue after each fired timer so
   * promise continuations (`await`s inside timer callbacks) run before the next
   * timer fires.
   */
  async advanceAsync(ms: number): Promise<void> {
    const target = this.current + ms;
    for (;;) {
      const next = this.takeNextDue(target);
      if (!next) break;
      this.current = next.due;
      next.fn();
      await flushMicrotasks();
    }
    this.current = target;
    await flushMicrotasks();
  }

  private takeNextDue(limit: number): PendingTimer | undefined {
    let best: PendingTimer | undefined;
    for (const t of this.timers.values()) {
      if (t.due > limit) continue;
      if (!best || t.due < best.due || (t.due === best.due && t.id < best.id)) best = t;
    }
    if (best) this.timers.delete(best.id);
    return best;
  }
}

/** Let already-queued promise continuations run (several turns deep). */
async function flushMicrotasks(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}
