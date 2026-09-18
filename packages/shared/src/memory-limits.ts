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
  /**
   * Max total SERIALIZED bytes retained per session, after per-event truncation
   * (`0` = unlimited). Default: 33554432 (32 MiB).
   *
   * ABSENT is not the same as an explicit `0`: absent (and negative /
   * non-numeric) falls back to the default, while an explicit `0` is preserved
   * as the documented rollback lever. The STORE — not this loader — clamps a
   * positive value up to a floor derived from the per-event ceiling, because
   * `maxEventDataSize` is a top-level `DashboardConfig` field this browser-safe
   * module cannot see.
   * See change: bound-event-store-by-bytes (D5/D6).
   */
  maxBytesPerSession: number;
  /**
   * Max total serialized event bytes across ALL resident sessions (`0` =
   * unlimited). Default: 805306368 (768 MiB). Presence rule as
   * `maxBytesPerSession`. See change: bound-event-store-by-bytes (D7).
   */
  maxTotalEventBytes: number;
  /**
   * Max resident session buffers; beyond this the least-recently-accessed
   * UNPINNED buffer is evicted. A plain count with no "unlimited" sentinel:
   * absent / `0` / negative / non-numeric all resolve to the default 32.
   * See change: bound-event-store-by-bytes (D8).
   */
  maxCachedSessions: number;
  /**
   * SHAPE of the replay window when one applies (`maxReplayEvents > 0`); inert
   * otherwise, like the rest of the window machinery.
   *
   * - `head-tail` (default): the shipped behaviour — a protected head segment
   *   beginning at the lowest stored seq, plus a tail segment.
   * - `tail-only`: the whole budget goes to the tail; `headEnd === 0` and the
   *   elided region is unbounded above.
   *
   * SERVER-SCOPED, not a per-browser preference: the window is computed before
   * any per-client preference is consulted, so flipping this changes the
   * transcript shape for EVERY client of this server.
   * See change: add-tail-only-replay-window (D1).
   */
  replayWindowMode: ReplayWindowMode;
}

/** See `MemoryLimitsConfig.replayWindowMode`. */
export type ReplayWindowMode = "head-tail" | "tail-only";

/**
 * Smallest representable replay window. A positive `maxReplayEvents` below this
 * clamps UP to it. `0` is never clamped — it means "unlimited", not "tiny".
 *
 * Rationale, RE-JUSTIFIED: the original one — "so `HEAD_MIN` (20) always fits
 * and a head-free window is unreachable by configuration" — is false since
 * `replayWindowMode: "tail-only"` reaches a head-free window deliberately. The
 * clamp survives on a REPLACEMENT rationale that is mode-independent: a
 * sub-100 tail is a degenerate transcript with or without a head, and a mode
 * switch silently doubling a user's configured `50` would be a worse surprise
 * than a documented floor.
 * See change: lazy-load-session-history (D3), add-tail-only-replay-window (D1).
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
  // The shipped shape stays the default; `tail-only` is opt-in and is also the
  // rollback lever (unset the field). See change: add-tail-only-replay-window.
  replayWindowMode: "head-tail",
  /**
   * 32 MiB. BELOW the 36 MB measured per pegged session on the live server
   * (heap snapshot, 35.8 h uptime) ON PURPOSE: a default above the observed
   * occupancy never fires, and the sessions that filled the heap were each
   * individually legal. A normal 1–3 KiB-event session is 20–60 MiB, so this
   * binds on exactly the chatty sessions that caused the OOM.
   * See change: bound-event-store-by-bytes (D5).
   */
  maxBytesPerSession: 32 * 1024 * 1024,
  /**
   * 768 MiB, sized to the 686 MB currently resident on the live server. The
   * per-session budget alone is insufficient — `maxBytesPerSession ×
   * maxCachedSessions` is the true envelope, and 32 × 32 MiB = 1 GiB exceeds
   * the global budget, so this is the binding constraint.
   * See change: bound-event-store-by-bytes (D7).
   */
  maxTotalEventBytes: 768 * 1024 * 1024,
  /**
   * 32 (was hardcoded 100 at `server.ts:925`). Covers the observed 13 active /
   * 19 pegged sessions with headroom; evicted sessions rehydrate from their
   * transcript on reopen, so the cost is latency on an old session, not loss.
   * MUST equal the store's `DEFAULT_MAX_CACHED_SESSIONS` (asserted by a test).
   * See change: bound-event-store-by-bytes (D8).
   */
  maxCachedSessions: 32,
};
