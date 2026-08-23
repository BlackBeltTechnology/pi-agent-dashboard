/**
 * Memory-limit defaults, in a BROWSER-SAFE module.
 *
 * Why this file exists rather than living in `config.ts`: `config.ts` imports
 * `node:fs` / `node:os` / `node:path` at module scope, so a VALUE import of it
 * from `packages/client` drags the Node built-ins into the browser bundle and
 * the SPA dies at boot with `uv.homedir is not a function` — a blank page, not
 * a build error. A `import type` from `config.ts` is erased and stays safe; a
 * value import is not. The settings panel needs the DEFAULT as a VALUE (to show
 * the effective default and to seed `memoryLimits`), so the constants move
 * here and `config.ts` re-exports them.
 *
 * Anything the client needs as a value belongs in a module like this one.
 *
 * See change: fix-lazy-history-backfill-ux (D7).
 */

export interface MemoryLimitsConfig {
  /** Max events stored per session (0 = unlimited). Default: 20000 */
  maxEventsPerSession: number;
  /** Max chars before truncating string fields in events (0 = no truncation). Default: 0 (disabled) */
  maxStringFieldSize: number;
  /** Max bytes in browser WebSocket send buffer before dropping messages (0 = no limit). Default: 4194304 (4MB) */
  maxWsBufferBytes: number;
  /**
   * Max events replayed to a browser on a FULL-stream subscribe (0 = unlimited).
   * Positive values below `MIN_REPLAY_WINDOW` clamp up. Default: 2000.
   *
   * ABSENT is not the same as an explicit `0`: absent (and negative /
   * non-numeric) falls back to the default, while an explicit `0` is preserved
   * as the documented rollback lever.
   * See change: lazy-load-session-history (D3, D13), fix-lazy-history-backfill-ux (D7).
   */
  maxReplayEvents: number;
}

/**
 * Smallest representable replay window. A positive `maxReplayEvents` below this
 * clamps UP to it, so `HEAD_MIN` (20) always fits inside the budget and a
 * head-free window is unreachable by configuration. `0` is never clamped — it
 * means "unlimited", not "tiny". See change: lazy-load-session-history (D3).
 */
export const MIN_REPLAY_WINDOW = 100;

export const DEFAULT_MEMORY_LIMITS: MemoryLimitsConfig = {
  // 20000 (was 5000): subagent-heavy turns forward thousands of inner events
  // into the parent buffer; the old cap trimmed the chat head.
  // See change: preserve-chat-head-on-event-trim.
  maxEventsPerSession: 20000,
  maxStringFieldSize: 0,
  maxWsBufferBytes: 4 * 1024 * 1024,
  /**
   * 2000 (was 0 = unlimited): at `0` nobody gets windowing without reading the
   * issue thread. `computeReplayWindow` early-returns when the compacted stream
   * fits, so any session compacting below 2000 takes the pre-change path
   * exactly. Geometry at 2000: head 200 (at `HEAD_CAP`, so the protected chat
   * head is maximal), tail 1800. `0` remains the exact rollback.
   * See change: lazy-load-session-history (D13), fix-lazy-history-backfill-ux (D7).
   */
  maxReplayEvents: 2000,
};
