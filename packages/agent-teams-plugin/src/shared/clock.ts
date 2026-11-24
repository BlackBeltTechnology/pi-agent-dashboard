/**
 * Injectable clock. Every timer in the plugin (wake confirm, urgent settle,
 * notice coalescing, shutdown grace, orphan TTL, rate-limit refill) reads time
 * and schedules through a `Clock`, so tests drive time deterministically with
 * the harness `FakeClock` instead of sleeping.
 * See change: add-agent-teams-core (test-plan: injected clock).
 */
export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
  /** Schedule `fn` after `ms`; returns an opaque handle for `clearTimeout`. */
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Production clock backed by the platform timers. */
export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
