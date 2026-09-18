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
   * COLD-START ONLY: `/api/restart` re-spawns with `env: process.env`, so a
   * changed value needs a full process start.
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
