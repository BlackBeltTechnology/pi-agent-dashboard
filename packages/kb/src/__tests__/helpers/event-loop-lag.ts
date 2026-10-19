// Event-loop lag probe for liveness tests (change: bound-kb-search-freshness, K1).
// Wraps an async operation and reports the max event-loop delay seen while it ran.
import { monitorEventLoopDelay } from "node:perf_hooks";

export async function withEventLoopLag<T>(fn: () => Promise<T>, resolutionMs = 10): Promise<{ result: T; maxDelayMs: number; elapsedMs: number }> {
  const h = monitorEventLoopDelay({ resolution: resolutionMs });
  h.enable();
  const t0 = performance.now();
  try {
    const result = await fn();
    return { result, maxDelayMs: h.max / 1e6, elapsedMs: performance.now() - t0 };
  } finally {
    h.disable();
  }
}
