/**
 * Heap + GC telemetry for the DASHBOARD SERVER process itself.
 *
 * `packages/extension/src/process-metrics.ts` instruments pi SESSIONS. The
 * server — the process this change actually bounds, and the only process in the
 * log corpus that has ever died of `FATAL ERROR: Reached heap limit` — had no
 * GC instrumentation at all. The accepted ~84% occupancy at a 1536 ceiling is
 * only defensible if pressure is visible before it becomes an OOM, so the
 * instrument ships with the ceiling.
 *
 * Three semantics differ deliberately from the session-side shape (design D13):
 *
 * 1. The GC count is CUMULATIVE, never read-and-reset. `/api/health` is a
 *    polled HTTP GET; a read-and-reset counter would make it non-idempotent and
 *    let two pollers erase each other's signal. "Is it climbing?" needs a
 *    monotonic number.
 * 2. The EFFECTIVE ceiling is derived from the running process's own
 *    argv/`NODE_OPTIONS` — never from the config file, which is exactly the
 *    value that may have diverged (`serverHeap` is cold-start-only).
 * 3. `heapSizeLimit` is NOT the request: it carries V8's fixed overhead
 *    (~192 MB observed) plus semi-space.
 *
 * See change: bound-session-heap-and-gc-telemetry (D13).
 */

import { constants as perfConstants, PerformanceObserver } from "node:perf_hooks";

let observer: PerformanceObserver | undefined;
let gcMajorCount = 0;
let gcMajorPauseMsTotal = 0;

/** Begin counting major collections. Idempotent; safe to call at boot. */
export function startServerHeapTelemetry(): void {
  if (observer) return;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // `entry.detail.kind`, never `entry.kind` — the latter is `undefined`
        // on the supported runtime and would score every GC as minor.
        const kind = (entry as { detail?: { kind?: number } }).detail?.kind;
        if (kind === perfConstants.NODE_PERFORMANCE_GC_MAJOR) {
          gcMajorCount += 1;
          gcMajorPauseMsTotal += entry.duration ?? 0;
        }
      }
    });
    observer.observe({ entryTypes: ["gc"] });
  } catch {
    // GC entry type unavailable — the fields simply stay at zero.
  }
}

/**
 * The old-space ceiling (MB) the RUNNING process was started with, or `null`
 * when it runs at the bare V8 default.
 *
 * Reads `execArgv` first — argv outranks `NODE_OPTIONS` when both carry the
 * flag (verified: `NODE_OPTIONS=8192` + argv `1024` ⇒ 1216 MB) — then falls
 * back to the environment, which is how the wrapper and the bridge launcher
 * deliver it. Deliberately NOT the config value: divergence between the two is
 * the thing this field exists to make visible.
 */
export function effectiveServerMaxOldSpaceMb(
  execArgv: string[] = process.execArgv,
  nodeOptions: string = process.env.NODE_OPTIONS ?? "",
): number | null {
  const match = (tokens: string[]): number | null => {
    // Last occurrence wins, matching V8's own precedence for a repeated flag.
    for (let i = tokens.length - 1; i >= 0; i--) {
      const m = /^--max[-_]old[-_]space[-_]size=(\d+)$/.exec(tokens[i]);
      if (m) return Number(m[1]);
    }
    return null;
  };
  return match(execArgv) ?? match(nodeOptions.split(/\s+/).filter(Boolean));
}

/** Server GC/ceiling fields for the `/api/health` `server` block. */
export function serverHeapTelemetry(): {
  gcMajorCount: number;
  gcMajorPauseMsTotal: number;
  effectiveMaxOldSpaceMb: number | null;
} {
  return {
    gcMajorCount,
    gcMajorPauseMsTotal: Math.round(gcMajorPauseMsTotal * 100) / 100,
    effectiveMaxOldSpaceMb: effectiveServerMaxOldSpaceMb(),
  };
}
