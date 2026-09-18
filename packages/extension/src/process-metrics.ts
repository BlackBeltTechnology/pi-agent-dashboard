/**
 * Lightweight process metrics collector for bridge heartbeats.
 * Uses Node.js built-in APIs — no external dependencies.
 */
import os from "node:os";
import {
  constants as perfConstants,
  type IntervalHistogram,
  monitorEventLoopDelay,
  PerformanceObserver,
} from "node:perf_hooks";
import v8 from "node:v8";
import type { ProcessMetrics } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";

const ELD_RESOLUTION_MS = 20;

let lastCpuUsage: NodeJS.CpuUsage | undefined;
let lastCpuTime: number | undefined;
let eld: IntervalHistogram | undefined;

// ── GC counters (change: bound-session-heap-and-gc-telemetry, D6) ──────────
// THREE SCALARS, folded in the observer callback and reset on each heartbeat
// read — the same read-and-reset shape the event-loop histogram above uses.
// Nothing accumulates between beats, so the memory-observation path cannot
// itself become a memory leak.
let gcObserver: PerformanceObserver | undefined;
let gcCount = 0;
let gcMajorCount = 0;
let gcPauseMsTotal = 0;

/**
 * Fold one GC performance entry into the counters.
 *
 * Major collections are classified by `entry.detail.kind`. `entry.kind` is
 * `undefined` on the supported runtime and MUST NOT be used — reading it
 * silently classifies every collection as minor. An entry with no `detail` is
 * counted in `gcCount` and skipped for `gcMajorCount` rather than throwing.
 */
export function foldGcEntry(entry: { duration?: number; detail?: unknown }): void {
  gcCount += 1;
  gcPauseMsTotal += typeof entry.duration === "number" ? entry.duration : 0;
  const kind = (entry.detail as { kind?: number } | undefined)?.kind;
  if (kind === perfConstants.NODE_PERFORMANCE_GC_MAJOR) gcMajorCount += 1;
}

/**
 * Zero the GC counters. Called from the heartbeat read (read-and-reset) and on
 * observer teardown, NOT only from tests — hence the plain name.
 */
export function resetGcCounters(): void {
  gcCount = 0;
  gcMajorCount = 0;
  gcPauseMsTotal = 0;
}


/** Start event loop delay monitoring. Call once at init. */
export function startMetricsMonitor(): void {
  if (eld) return; // already started
  try {
    eld = monitorEventLoopDelay({ resolution: ELD_RESOLUTION_MS });
    eld.enable();
  } catch {
    // monitorEventLoopDelay not available in older Node versions
  }
  try {
    // Assigned only AFTER observe() succeeds: a constructed-but-unsubscribed
    // observer would make `collectMetrics` report `gcCount: 0` — "no GC
    // happened" — when in truth nothing is counting.
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) foldGcEntry(entry);
    });
    observer.observe({ entryTypes: ["gc"] });
    gcObserver = observer;
  } catch {
    // GC entry type unavailable — the counters simply stay absent.
  }
}

/** Stop event loop delay monitoring. */
export function stopMetricsMonitor(): void {
  if (eld) {
    eld.disable();
    eld = undefined;
  }
  if (gcObserver) {
    gcObserver.disconnect();
    gcObserver = undefined;
    resetGcCounters();
  }
}

/** Collect current process metrics and reset deltas. */
export function collectMetrics(): ProcessMetrics {
  const mem = process.memoryUsage();

  // CPU percent since last call
  const now = Date.now();
  const cpuNow = process.cpuUsage();
  let cpuPercent = 0;
  if (lastCpuUsage && lastCpuTime) {
    const elapsedMs = now - lastCpuTime;
    if (elapsedMs > 0) {
      const userDelta = cpuNow.user - lastCpuUsage.user;   // microseconds
      const systemDelta = cpuNow.system - lastCpuUsage.system;
      // Total CPU microseconds / elapsed wall-clock microseconds * 100
      cpuPercent = ((userDelta + systemDelta) / (elapsedMs * 1000)) * 100;
    }
  }
  lastCpuUsage = cpuNow;
  lastCpuTime = now;

  // Event loop max delay since last reset
  let eventLoopMaxMs: number | undefined;
  if (eld) {
    // max is in nanoseconds
    eventLoopMaxMs = Math.round(eld.max / 1_000_000);
    eld.reset();
  }

  // GC counters since the last read, then reset (design D6).
  let gc: Pick<ProcessMetrics, "gcCount" | "gcMajorCount" | "gcPauseMsTotal"> = {};
  if (gcObserver) {
    gc = {
      gcCount,
      gcMajorCount,
      gcPauseMsTotal: Math.round(gcPauseMsTotal * 100) / 100,
    };
    resetGcCounters();
  }

  return {
    rss: mem.rss,
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    eventLoopMaxMs,
    loadAvg1m: Math.round(os.loadavg()[0] * 100) / 100,
    // The ceiling this process actually runs under — without it `heapUsed` is
    // an unreadable number. See change: bound-session-heap-and-gc-telemetry.
    heapSizeLimit: v8.getHeapStatistics().heap_size_limit,
    external: mem.external,
    arrayBuffers: mem.arrayBuffers,
    ...gc,
  };
}
