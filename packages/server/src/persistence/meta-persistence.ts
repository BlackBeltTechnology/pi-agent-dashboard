/**
 * Per-session debounced `.meta.json` writer.
 * Each session gets its own debounce timer — updating session A
 * does not trigger a write for session B.
 */
import { type SessionMeta, metaPath, readSessionMeta, writeSessionMeta, mergeSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import type { DisplayPrefs, PartialDisplayPrefs } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";

const DEBOUNCE_MS = 1000;

export interface MetaPersistence {
  /** Schedule a debounced write of the session's `.meta.json`. */
  save(sessionFile: string, meta: SessionMeta): void;
  /**
   * Synchronously set (or, when `override === null`, delete) the
   * per-session `displayPrefsOverride` field in `.meta.json`. Performs
   * read-modify-write via `mergeSessionMeta`, bypassing the debounce
   * queue so callers see the change reflected immediately on disk.
   * See change: configurable-chat-display.
   */
  setDisplayPrefsOverride(sessionFile: string, override: PartialDisplayPrefs | null): void;
  /**
   * Synchronously write the per-session `processDrawerCollapsed` field in
   * `.meta.json`, bypassing the debounce queue. See change:
   * persist-process-drawer-collapse.
   */
  setProcessDrawerCollapsed(sessionFile: string, collapsed: boolean): void;
  /**
   * Eagerly (atomically, NOT debounced) write the liveness marker fields
   * into `.meta.json`. Used to stamp `{ live, liveEpoch }` while a session
   * runs and `{ live:false, closedReason? }` on close, so the marker is
   * durable on disk before an unclean host shutdown. Merges onto any pending
   * debounced write so an in-flight stats update is not lost.
   * See change: reopen-sessions-after-shutdown.
   */
  setLiveness(
    sessionFile: string,
    liveness: { live: boolean; liveEpoch?: number; closedReason?: string },
  ): void;
  /** Flush all pending writes immediately. */
  flushAll(): void;
  /** Stop all debounce timers. */
  dispose(): void;
}

interface PendingWrite {
  sessionFile: string;
  meta: SessionMeta;
  timer: ReturnType<typeof setTimeout>;
}

export function createMetaPersistence(): MetaPersistence {
  // Keyed by sessionFile path
  const pending = new Map<string, PendingWrite>();

  function writeNow(sessionFile: string): void {
    const entry = pending.get(sessionFile);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(sessionFile);
    // The debounced path owns all fields EXCEPT the eager liveness marker
    // (see change: reopen-sessions-after-shutdown / design D2). `save()`
    // performs a full overwrite, so carry forward any on-disk liveness
    // fields the caller did not explicitly set — otherwise a routine stats
    // write would clobber `live`/`liveEpoch`/`closedReason`.
    const meta = { ...entry.meta };
    if (meta.live === undefined && meta.liveEpoch === undefined && meta.closedReason === undefined) {
      const onDisk = readSessionMeta(sessionFile);
      if (onDisk?.live !== undefined) meta.live = onDisk.live;
      if (onDisk?.liveEpoch !== undefined) meta.liveEpoch = onDisk.liveEpoch;
      if (onDisk?.closedReason !== undefined) meta.closedReason = onDisk.closedReason;
    }
    writeSessionMeta(sessionFile, meta);
  }

  return {
    setDisplayPrefsOverride(sessionFile: string, override: PartialDisplayPrefs | null): void {
      const existing = readSessionMeta(sessionFile) ?? {};
      if (override === null) {
        // Remove the field so the session falls back to pure global prefs.
        const { displayPrefsOverride: _drop, ...rest } = existing;
        writeSessionMeta(sessionFile, rest);
      } else {
        mergeSessionMeta(sessionFile, { displayPrefsOverride: override });
      }
    },

    setProcessDrawerCollapsed(sessionFile: string, collapsed: boolean): void {
      mergeSessionMeta(sessionFile, { processDrawerCollapsed: collapsed });
    },

    setLiveness(sessionFile, liveness): void {
      // Fold any pending debounced fields into the eager write so a queued
      // stats update is not clobbered by this out-of-band write.
      const queued = pending.get(sessionFile);
      if (queued) {
        clearTimeout(queued.timer);
        pending.delete(sessionFile);
      }
      const base = queued?.meta ?? readSessionMeta(sessionFile) ?? {};
      const next: SessionMeta = { ...base, live: liveness.live };
      // Liveness fields omitted from this payload MUST be cleared, not
      // carried forward from the prior sidecar — otherwise a stale
      // `closedReason: "manual"` survives a later `{ live:true }` re-activation
      // and wrongly excludes a resumed-then-crashed session from recovery.
      // See change: reopen-sessions-after-shutdown.
      if (liveness.liveEpoch !== undefined) next.liveEpoch = liveness.liveEpoch;
      else delete next.liveEpoch;
      if (liveness.closedReason !== undefined) next.closedReason = liveness.closedReason;
      else delete next.closedReason;
      writeSessionMeta(sessionFile, next);
    },

    save(sessionFile: string, meta: SessionMeta): void {
      const existing = pending.get(sessionFile);
      if (existing) {
        // Update meta and reset timer
        clearTimeout(existing.timer);
        existing.meta = meta;
        existing.timer = setTimeout(() => writeNow(sessionFile), DEBOUNCE_MS);
      } else {
        const timer = setTimeout(() => writeNow(sessionFile), DEBOUNCE_MS);
        pending.set(sessionFile, { sessionFile, meta, timer });
      }
    },

    flushAll(): void {
      for (const sessionFile of [...pending.keys()]) {
        writeNow(sessionFile);
      }
    },

    dispose(): void {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
      }
      pending.clear();
    },
  };
}
