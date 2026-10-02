/**
 * V8 heap-sizing defaults, in a BROWSER-SAFE module.
 *
 * Same reason `memory-limits.ts` exists: `config.ts` imports `node:fs` /
 * `node:os` / `node:path` at module scope, so a VALUE import of it from
 * `packages/client` drags Node built-ins into the SPA bundle and the page dies
 * at boot. The settings panel needs these defaults AND the coupling-guard
 * formula as VALUES, so they live here and `config.ts` re-exports them.
 *
 * DISTINCT from `memory-limits.ts`, which bounds the EVENT STORE (events per
 * session, WS buffer, replay window, byte budgets). Nothing here touches the
 * store; nothing there touches V8.
 *
 * See change: bound-session-heap-and-gc-telemetry (D7).
 */

/** Spawned pi-session V8 sizing. See change: bound-session-heap-and-gc-telemetry. */
export interface SessionHeapConfig {
  /**
   * `--max-old-space-size` request (MB) for a spawned pi session. Default 512.
   *
   * NOT the observable ceiling: V8 adds a fixed overhead (~192 MB on the
   * measurement host) so a 512 request reports ~700 MB `heap_size_limit`.
   */
  maxOldSpaceMb: number;
  /** `--initial-old-space-size` (MB), the `-Xms` analogue. Unset by default. */
  initialOldSpaceMb?: number;
  /** `--max-semi-space-size` (MB), young generation. Unset by default. */
  maxSemiSpaceMb?: number;
}

/** Dashboard-server V8 sizing. See change: bound-session-heap-and-gc-telemetry. */
export interface ServerHeapConfig {
  /**
   * `--max-old-space-size` request (MB) for the dashboard server. Default 1536,
   * replacing the previously hardcoded 8192.
   *
   * Applied on every launch path (wrapper, bridge, Electron) and re-read by
   * `/api/restart`, so a changed value takes effect on the next restart.
   * See change: guard-server-heap-and-store-coupling (D3, D5).
   */
  maxOldSpaceMb: number;
}

/**
 * Smallest supported `maxOldSpaceMb`. Below 64 MB V8's ~192 MB fixed overhead
 * dominates the request and the number stops meaning anything
 * (measured requested→effective: 1024→1216, 256→448, 64→256, 16→208).
 */
export const MIN_HEAP_MB = 64;

/**
 * Largest value accepted without comment. Above it the entry field warns but
 * still accepts — an operator with a big host may legitimately want more.
 */
export const HEAP_WARN_ABOVE_MB = 8192;

export const DEFAULT_SESSION_HEAP: SessionHeapConfig = {
  /**
   * 512. Measured peak across 11 live sessions was 148 MB `heapUsed` against
   * the 8384 MB ceiling they inherited from the server — the headroom is
   * unused, and V8 sizes major-GC aggressiveness against the ceiling.
   */
  maxOldSpaceMb: 512,
};

export const DEFAULT_SERVER_HEAP: ServerHeapConfig = {
  /**
   * 1536. ~112 MB non-store baseline + the 768 MiB store budget expressed as
   * HEAP (~1024 MB — the budget counts serialized `data` bytes, not V8 heap
   * bytes) + ~51 MB `GLOBAL_TRIM_SLACK` ⇒ ~1187 MB steady state against a
   * ~1417 MB effective crash point: ~84% occupancy, an accepted trade-off
   * rather than a comfortable margin. Raise to 2048 (~65%) if the telemetry
   * this change adds shows sustained pressure.
   */
  maxOldSpaceMb: 1536,
};

/**
 * Per-child heap guidance figure (MB) below which the session ceiling and the
 * subagent fan-out bound are a risky pairing.
 */
export const SUBAGENT_HEAP_GUIDANCE_MB = 100;

/**
 * Subagents run IN-PROCESS and share the parent's single V8 heap, so
 * `maxConcurrentSubagents` is a memory-safety knob once a ceiling is enforced.
 * `+ 1` accounts for the parent itself.
 *
 * One formula, used by both the settings panel and its tests, so the warning
 * the operator sees and the number the test asserts cannot drift.
 * See change: bound-session-heap-and-gc-telemetry (task 10.8).
 */
export function subagentHeapBudget(
  maxOldSpaceMb: number,
  maxConcurrentSubagents: number,
): { perChildMb: number; warn: boolean } {
  if (
    !Number.isFinite(maxOldSpaceMb) ||
    !Number.isFinite(maxConcurrentSubagents) ||
    maxConcurrentSubagents < 0
  ) {
    return { perChildMb: 0, warn: false };
  }
  const perChildMb = Math.floor(maxOldSpaceMb / (maxConcurrentSubagents + 1));
  return { perChildMb, warn: perChildMb < SUBAGENT_HEAP_GUIDANCE_MB };
}

/**
 * Heap MB one MiB of `maxTotalEventBytes` budget costs: 768 MiB of serialized
 * event data ≈ 1 GiB of V8 heap. Per MiB, NOT per byte — the budget is stored
 * in bytes, so the guard divides by 1024² first.
 */
export const HEAP_MB_PER_BUDGET_MIB = 1.33;

/** Non-store live set (MB): 798 MB live − 686 MB strings, one heap snapshot. */
export const BASELINE_MB = 112;

/** Fraction of the requested ceiling at which the server OOMed (~1000 of 1216 MB). */
export const CRASH_RATIO = 0.82;

const BYTES_PER_MIB = 1024 * 1024;

/**
 * Server-heap × store-budget coupling guard. Warns when the store budget,
 * converted to heap, plus the baseline exceeds the ceiling's crash point:
 * `budgetMiB × HEAP_MB_PER_BUDGET_MIB + BASELINE_MB > ceilingMb × CRASH_RATIO`.
 *
 * Takes the budget in BYTES (as `MemoryLimitsConfig` stores it) and converts
 * internally, so no caller can feed a byte count into a MiB term. `0` means
 * unlimited: always warns, as `unbounded`, with no heap figure. Reads the
 * CONFIGURED budget, not the store's post-clamp effective one (design D1).
 *
 * A single-host tripwire, not a proof of fit. Non-blocking by contract.
 * See change: guard-server-heap-and-store-coupling (D1).
 */
export function serverHeapStoreCoupling(
  maxTotalEventBytes: number,
  serverMaxOldSpaceMb: number,
): { warn: boolean; unbounded: boolean; projectedHeapMb: number | null; crashPointMb: number } {
  const crashPointMb = Math.round(serverMaxOldSpaceMb * CRASH_RATIO);
  if (
    !Number.isFinite(maxTotalEventBytes) ||
    !Number.isFinite(serverMaxOldSpaceMb) ||
    maxTotalEventBytes < 0
  ) {
    return { warn: false, unbounded: false, projectedHeapMb: null, crashPointMb };
  }
  if (maxTotalEventBytes === 0) {
    return { warn: true, unbounded: true, projectedHeapMb: null, crashPointMb };
  }
  const projected = (maxTotalEventBytes / BYTES_PER_MIB) * HEAP_MB_PER_BUDGET_MIB + BASELINE_MB;
  return {
    warn: projected > serverMaxOldSpaceMb * CRASH_RATIO,
    unbounded: false,
    projectedHeapMb: Math.round(projected),
    crashPointMb,
  };
}
