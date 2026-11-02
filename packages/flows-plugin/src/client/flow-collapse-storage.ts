/**
 * Per-session persistence for the flow socket's collapse state. The whole-panel
 * (`FlowSummary`) and live-dashboard (`FlowDashboard`) collapses are stored in
 * localStorage keyed by session id, so collapsing a session's flow panel sticks
 * across remounts/reloads instead of re-opening every time. Mirrors the
 * try/catch-swallow pattern of `useSidebarState.ts`; a localStorage failure
 * (quota / disabled / private mode) degrades to in-memory state and never throws.
 *
 * Default is COLLAPSED (true) for any session with no stored choice: the panel
 * never expands on its own when a flow starts, completes or fails. Open flow…
 * expands it via `setFlowCollapsed` (same-tab writes notify mounted toggles).
 *
 * See change: fix-flow-ui-graph-zoom-summary; flows-dock-chip-and-panel-actions (D10).
 */
import { useCallback, useEffect, useState } from "react";

/** Default for a session with no stored collapse choice. */
const FLOW_COLLAPSE_DEFAULT = true;

/** Same-tab listeners per key, so an explicit write reaches mounted toggles. */
const keyListeners = new Map<string, Set<(v: boolean) => void>>();

export type FlowCollapseKind = "summary" | "dashboard";

/** localStorage key for a (kind, session) pair. */
export function flowCollapseKey(kind: FlowCollapseKind, sessionId: string): string {
  return `dashboard:flow-${kind}-collapsed:${sessionId}`;
}

function readBoolean(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
}

function writeBoolean(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* noop — degrade to in-memory */
  }
}

/**
 * Generic localStorage-backed boolean toggle. Returns `[value, toggle]`.
 * `key === null` → purely in-memory (no persistence). Re-syncs on key change
 * (so a component reused under a new key reads the right value) without
 * clobbering a same-key toggle. localStorage failures degrade to in-memory.
 */
export function usePersistedToggle(
  key: string | null,
  fallback: boolean,
): [boolean, () => void] {
  const [value, setValue] = useState<boolean>(() => (key ? readBoolean(key, fallback) : fallback));

  useEffect(() => {
    setValue(key ? readBoolean(key, fallback) : fallback);
    if (!key) return;
    let set = keyListeners.get(key);
    if (!set) keyListeners.set(key, (set = new Set()));
    set.add(setValue);
    return () => {
      set.delete(setValue);
      if (set.size === 0) keyListeners.delete(key);
    };
  }, [key, fallback]);

  const toggle = useCallback(() => {
    setValue((prev) => {
      const next = !prev;
      if (key) writeBoolean(key, next);
      return next;
    });
  }, [key]);

  return [value, toggle];
}

/** localStorage key for the global error-route visibility toggle (not session-scoped). */
export const FLOW_SHOW_ERROR_ROUTES_KEY = "dashboard:flow-show-error-routes";

/**
 * Persisted collapse state for one flow panel. Returns `[collapsed, toggle]`.
 * When `sessionId` is undefined the state is purely in-memory (no key to scope by).
 */
export function useFlowCollapsePersisted(
  sessionId: string | undefined,
  kind: FlowCollapseKind,
): [boolean, () => void] {
  return usePersistedToggle(sessionId ? flowCollapseKey(kind, sessionId) : null, FLOW_COLLAPSE_DEFAULT);
}

/**
 * Explicit write (Open flow… expands): persists `collapsed` for the session's
 * panel kind(s) and updates every mounted toggle for that key in this tab.
 */
export function setFlowCollapsed(sessionId: string, kinds: readonly FlowCollapseKind[], collapsed: boolean): void {
  for (const kind of kinds) {
    const key = flowCollapseKey(kind, sessionId);
    writeBoolean(key, collapsed);
    for (const fn of keyListeners.get(key) ?? []) fn(collapsed);
  }
}
