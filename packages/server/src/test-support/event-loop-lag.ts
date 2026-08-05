/**
 * Event-loop lag measurement for tests.
 *
 * No existing test measured this, but "the resize runs off the event loop" is a
 * load-bearing claim of the display-fit design (D4): jimp is pure JS and
 * single-threaded, so an inline resize would stall EVERY session's event
 * processing for 174–874 ms. Asserting the offload therefore needs a way to
 * observe how long the loop was blocked, not just how long the work took.
 *
 * Works by scheduling a fixed-interval timer and recording how late each tick
 * actually fires. A tick that should arrive every `intervalMs` but arrives
 * `intervalMs + N` later means the loop was blocked for ~N ms.
 *
 * See change: fit-attachments-for-display (task 6.1).
 */

export interface LagMonitor {
  /** Stop sampling and return the worst lag observed, in ms. */
  stop(): number;
  /** Worst lag so far without stopping, in ms. */
  peek(): number;
}

/**
 * Start sampling event-loop lag.
 *
 * `intervalMs` trades resolution against self-inflicted load; 10 ms is fine for
 * a 50 ms budget. The timer is `unref`'d so it can never hold the process open.
 */
export function startLagMonitor(intervalMs = 10): LagMonitor {
  let maxLag = 0;
  let last = performance.now();

  // Anything beyond the scheduled interval is time the loop was unavailable.
  // Called from the tick AND from peek()/stop(), because a block can start and
  // end without a single tick getting the chance to run.
  const sample = (advance: boolean) => {
    const now = performance.now();
    const lag = now - last - intervalMs;
    if (lag > maxLag) maxLag = lag;
    if (advance) last = now;
  };

  const timer = setInterval(() => sample(true), intervalMs);
  // Never keep the event loop alive on account of measurement.
  (timer as unknown as { unref?: () => void }).unref?.();

  return {
    peek() {
      sample(false);
      return maxLag;
    },
    stop() {
      // Take one final sample BEFORE clearing. Without it, work that blocks the
      // loop from start() until stop() prevents every tick from running, and
      // the monitor reports 0 — the perf gate would then pass the exact
      // blocking regression it exists to catch.
      sample(true);
      clearInterval(timer);
      return maxLag;
    },
  };
}
