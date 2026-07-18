/**
 * Per-session editor-pane tree-rail visibility with `localStorage` persistence.
 *
 * The rail show/hide toggle stores a boolean under
 * `pi-dashboard:tree-visible:<sessionId>` so the rail's shown/hidden state
 * survives reload and dashboard restart within the same browser profile.
 * Best-effort read/write; defaults to collapsed (a freshly-opened split viewer
 * fills the pane width; a user's explicit reveal persists per session).
 *
 * See change: improve-content-editor (discoverable rail toggle #6).
 * See change: collapse-files-panel-by-default.
 */

import { useEffect, useRef, useState } from "react";

export const TREE_VISIBLE_KEY_PREFIX = "pi-dashboard:tree-visible:";
const DEFAULT_VISIBLE = false;

function keyFor(sessionId: string): string {
  return TREE_VISIBLE_KEY_PREFIX + sessionId;
}

/** Read persisted visibility; default (collapsed) on absence/corruption. */
export function loadTreeVisible(sessionId: string): boolean {
  if (!sessionId) return DEFAULT_VISIBLE;
  try {
    const raw = globalThis.localStorage?.getItem(keyFor(sessionId));
    if (raw === null || raw === undefined) return DEFAULT_VISIBLE;
    return raw === "true";
  } catch (err) {
    console.error(`[tree-visible] failed to read state for session ${sessionId}`, err);
    return DEFAULT_VISIBLE;
  }
}

/** Persist visibility; silently drops the write on quota/disabled storage. */
export function saveTreeVisible(sessionId: string, visible: boolean): void {
  if (!sessionId) return;
  try {
    globalThis.localStorage?.setItem(keyFor(sessionId), String(visible));
  } catch (err) {
    console.warn(`[tree-visible] failed to persist state for session ${sessionId}`, err);
  }
}

/** Session-scoped tree visibility. Loads on mount / session change; persists on set. Defaults collapsed until the user reveals the rail. */
export function useTreeVisible(sessionId: string): [boolean, (visible: boolean) => void] {
  const [visible, setVisible] = useState<boolean>(() => loadTreeVisible(sessionId));
  const prevSession = useRef(sessionId);

  useEffect(() => {
    if (prevSession.current !== sessionId) {
      prevSession.current = sessionId;
      setVisible(loadTreeVisible(sessionId));
      return;
    }
    saveTreeVisible(sessionId, visible);
  }, [sessionId, visible]);

  return [visible, setVisible];
}
