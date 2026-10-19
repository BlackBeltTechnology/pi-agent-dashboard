/**
 * Two-lane, abortable concurrency gate for `GET /api/file/digest` hashing.
 *
 * At most `max` hashes run at once. Waiters queue in two lanes: `baseline`
 * requests (a tab is about to mount and is blocked on the result) are served
 * before any queued `verify` request (background candidate checks), so a tab
 * switch never waits behind a `git checkout` burst. A waiter whose client went
 * away is removed from the queue; an active holder releases its slot through the
 * returned `release` (called when the hash finishes or aborts).
 *
 * See change: gate-changed-on-disk-by-content (D4).
 */
export type DigestLane = "baseline" | "verify";

export interface DigestGate {
  /** Resolves with a one-shot `release`. Rejects with an `AbortError` if `signal` aborts first. */
  acquire(lane: DigestLane, signal?: AbortSignal): Promise<() => void>;
  stats(): { active: number; queued: number; peakActive: number };
}

interface Waiter {
  lane: DigestLane;
  grant: () => void;
  cleanup: () => void;
}

function abortError(): Error {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}

export function createDigestGate(max = 2, onGrant?: (lane: DigestLane) => void): DigestGate {
  let active = 0;
  let peakActive = 0;
  const queues: Record<DigestLane, Waiter[]> = { baseline: [], verify: [] };

  function take(lane: DigestLane): (() => void) {
    active++;
    if (active > peakActive) peakActive = active;
    onGrant?.(lane);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active--;
      drain();
    };
  }

  function drain(): void {
    while (active < max) {
      const next = queues.baseline.shift() ?? queues.verify.shift();
      if (!next) return;
      next.cleanup();
      next.grant();
    }
  }

  return {
    acquire(lane, signal) {
      if (signal?.aborted) return Promise.reject(abortError());
      if (active < max) return Promise.resolve(take(lane));
      return new Promise<() => void>((resolve, reject) => {
        const waiter: Waiter = {
          lane,
          grant: () => resolve(take(lane)),
          cleanup: () => signal?.removeEventListener("abort", onAbort),
        };
        const onAbort = (): void => {
          const q = queues[lane];
          const i = q.indexOf(waiter);
          if (i >= 0) q.splice(i, 1);
          reject(abortError());
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        queues[lane].push(waiter);
      });
    },
    stats: () => ({ active, queued: queues.baseline.length + queues.verify.length, peakActive }),
  };
}
