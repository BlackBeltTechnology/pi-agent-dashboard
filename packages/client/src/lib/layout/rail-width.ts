/**
 * Per-session browse-rail width with `localStorage` persistence.
 *
 * The editor pane's inner rail↔viewer divider stores a clamped pixel width
 * (a tree rail reads better at a stable width than a proportional one) under
 * `pi-dashboard:rail:<sessionId>`, alongside the pane state. Independent of the
 * outer chat/editor split ratio. Best-effort read/write.
 *
 * See change: split-editor-workspace.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { clampWidth } from "./useSplitRatio.js";

export const RAIL_KEY_PREFIX = "pi-dashboard:rail:";
export const RAIL_MIN = 160;
export const RAIL_MAX = 480;
export const RAIL_DEFAULT = 224; // matches the prior fixed `w-56` rail.

/** Clamp a rail width into `[RAIL_MIN, RAIL_MAX]`; NaN → default. */
export function clampRailWidth(width: number): number {
  if (!Number.isFinite(width)) return RAIL_DEFAULT;
  return clampWidth(width, RAIL_MIN, RAIL_MAX);
}

function keyFor(sessionId: string): string {
  return RAIL_KEY_PREFIX + sessionId;
}

/** Read persisted rail width; default on absence/corruption. */
export function loadRailWidth(sessionId: string): number {
  if (!sessionId) return RAIL_DEFAULT;
  try {
    const raw = globalThis.localStorage?.getItem(keyFor(sessionId));
    if (!raw) return RAIL_DEFAULT;
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      console.error(`[rail-width] discarding corrupt width for session ${sessionId}`);
      return RAIL_DEFAULT;
    }
    return clampRailWidth(n);
  } catch (err) {
    console.error(`[rail-width] failed to read width for session ${sessionId}`, err);
    return RAIL_DEFAULT;
  }
}

/** Persist rail width; silently drops the write on quota/disabled storage. */
export function saveRailWidth(sessionId: string, width: number): void {
  if (!sessionId) return;
  try {
    globalThis.localStorage?.setItem(keyFor(sessionId), String(width));
  } catch (err) {
    console.warn(`[rail-width] failed to persist width for session ${sessionId}`, err);
  }
}

/** Session-scoped rail width. Loads on mount / session change; persists + clamps on set. */
export function useRailWidth(sessionId: string): [number, (width: number) => void] {
  const [width, setWidth] = useState<number>(() => loadRailWidth(sessionId));
  const prevSession = useRef(sessionId);

  useEffect(() => {
    if (prevSession.current !== sessionId) {
      prevSession.current = sessionId;
      setWidth(loadRailWidth(sessionId));
      return;
    }
    saveRailWidth(sessionId, width);
  }, [sessionId, width]);

  const set = useCallback((w: number) => setWidth(clampRailWidth(w)), []);
  return [width, set];
}
