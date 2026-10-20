/**
 * Per-session supervised-mode store.
 *
 * Backed by two `Map<sessionId, …>` that live on the process-global `BridgeState`
 * (never one flag), so a session switch never inherits the previous session's
 * mode and a /reload keeps the values. A session with no entry resolves to the
 * configured default (`supervisedMode.default === "supervised"`). Persistence /
 * restore (`supervised-mode` session entry, server meta) layers on top of this.
 * See change: add-supervised-tool-approval (design D4).
 */
export interface ModeStoreBacking {
  supervisedModes?: Map<string, boolean>;
  supervisedRevs?: Map<string, number>;
}

export interface SupervisedModeStore {
  /** Effective mode: the session's entry, else the configured default. */
  get(sessionId: string): boolean;
  /** True when the session has an explicit entry. */
  has(sessionId: string): boolean;
  /** Set the mode; `rev` defaults to the previous rev + 1. Returns the stored rev. */
  set(sessionId: string, on: boolean, rev?: number): number;
  /** Last flip revision (0 when never flipped). */
  rev(sessionId: string): number;
  /** Drop the session's mode + rev (session_shutdown). */
  clear(sessionId: string): void;
}

export function createModeStore(backing: ModeStoreBacking, getDefault: () => boolean): SupervisedModeStore {
  const modes = (backing.supervisedModes ??= new Map());
  const revs = (backing.supervisedRevs ??= new Map());
  return {
    get(sessionId) {
      const v = modes.get(sessionId);
      return v === undefined ? getDefault() : v;
    },
    has: (sessionId) => modes.has(sessionId),
    set(sessionId, on, rev) {
      const next = rev ?? (revs.get(sessionId) ?? 0) + 1;
      modes.set(sessionId, on);
      revs.set(sessionId, next);
      return next;
    },
    rev: (sessionId) => revs.get(sessionId) ?? 0,
    clear(sessionId) {
      modes.delete(sessionId);
      revs.delete(sessionId);
    },
  };
}
