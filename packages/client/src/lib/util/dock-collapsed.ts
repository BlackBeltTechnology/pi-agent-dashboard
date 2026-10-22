/**
 * Per-session composer-dock collapsed state with `localStorage` persistence.
 *
 * Stores `"collapsed"` under `pi-dashboard:composer-dock-collapsed:<sessionId>`;
 * anything else (absent, corrupt, storage throws) reads as **expanded** — the
 * dock never collapses on its own. An empty `sessionId` (folder home) neither
 * reads nor writes. Best-effort like `tree-visible.ts`, but `useDockCollapsed`
 * derives the value from `(sessionId, state)` during render so a session switch
 * never shows the previous session's value for a frame. A peek is NOT stored.
 *
 * See change: composer-dock-collapse-and-file-open (D1).
 */

import { useCallback, useState } from "react";

export const DOCK_COLLAPSED_KEY_PREFIX = "pi-dashboard:composer-dock-collapsed:";
const COLLAPSED = "collapsed";

function keyFor(sessionId: string): string {
  return DOCK_COLLAPSED_KEY_PREFIX + sessionId;
}

/** Read the persisted state; `false` (expanded) on absence, corruption or a throwing store. */
export function loadDockCollapsed(sessionId: string): boolean {
  if (!sessionId) return false;
  try {
    return globalThis.localStorage?.getItem(keyFor(sessionId)) === COLLAPSED;
  } catch {
    return false;
  }
}

/** Persist the state (expanded removes the key); silently drops a failing write. */
export function saveDockCollapsed(sessionId: string, collapsed: boolean): void {
  if (!sessionId) return;
  try {
    if (collapsed) globalThis.localStorage?.setItem(keyFor(sessionId), COLLAPSED);
    else globalThis.localStorage?.removeItem(keyFor(sessionId));
  } catch {
    // best-effort
  }
}

/**
 * Collapsed state of the dock bound to `sessionId`. `persist: false` (a dock that is not
 * live for its session) reads the stored value but never writes it and ignores `set`.
 */
export function useDockCollapsed(sessionId: string, persist = true): [boolean, (collapsed: boolean) => void] {
  const [tracked, setTracked] = useState(() => ({ sessionId, collapsed: loadDockCollapsed(sessionId) }));
  let current = tracked;
  if (tracked.sessionId !== sessionId) {
    current = { sessionId, collapsed: loadDockCollapsed(sessionId) };
    setTracked(current);
  }
  const set = useCallback(
    (collapsed: boolean) => {
      if (!persist || !sessionId) return;
      saveDockCollapsed(sessionId, collapsed);
      setTracked({ sessionId, collapsed });
    },
    [persist, sessionId],
  );
  return [current.collapsed, set];
}
