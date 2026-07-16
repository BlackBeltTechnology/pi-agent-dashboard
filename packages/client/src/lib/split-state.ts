/**
 * Per-session split-workspace state with `localStorage` persistence.
 *
 * The chat + editor split's open state, divider ratio, and orientation persist
 * under `pi-dashboard:split:<sessionId>` so they survive reload within the same
 * browser profile. Mirrors the `editor-pane-state.ts` idiom. All storage access
 * is best-effort: quota errors and corrupt JSON never crash the workspace —
 * they log and fall back to the default (closed) state.
 *
 * See change: split-editor-workspace.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export const SPLIT_KEY_PREFIX = "pi-dashboard:split:";

/** Divider ratio clamp — neither pane may collapse below a usable minimum. */
export const RATIO_MIN = 0.25;
export const RATIO_MAX = 0.75;

export type SplitOrientation = "h" | "v";

/**
 * Content-area layout mode:
 *   - `closed` — chat only (editor collapsed to a right-edge peek),
 *   - `split`  — chat | divider | editor (draggable),
 *   - `full`   — editor only (chat collapsed to a leading-edge peek).
 */
export type SplitMode = "closed" | "split" | "full";

export interface SplitState {
  /** Which of the three content-area layouts is active. */
  mode: SplitMode;
  /** Chat pane fraction of the split (0..1); editor gets the remainder. Only applies in `split`. */
  ratio: number;
  /** `h` = side-by-side (desktop), `v` = stacked (mobile). */
  orientation: SplitOrientation;
}

export const DEFAULT_SPLIT_STATE: SplitState = { mode: "closed", ratio: 0.5, orientation: "h" };

const isMode = (v: unknown): v is SplitMode => v === "closed" || v === "split" || v === "full";

/** Clamp a divider ratio into `[RATIO_MIN, RATIO_MAX]`; NaN → default ratio. */
export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_SPLIT_STATE.ratio;
  return Math.max(RATIO_MIN, Math.min(RATIO_MAX, ratio));
}

function keyFor(sessionId: string): string {
  return SPLIT_KEY_PREFIX + sessionId;
}

/**
 * Migrate a raw persisted blob to a well-formed `SplitState`, or `null` when
 * corrupt. Accepts both the new `mode` shape and the legacy `open` boolean, with
 * an explicit **precedence** so a blob carrying both fields cannot corrupt:
 *   1. `mode` in the enum → use it (mode wins over any legacy `open`).
 *   2. else `typeof open === "boolean"` → `open ? "split" : "closed"`.
 *   3. else → corrupt (`null`).
 * `ratio` is clamped (an out-of-clamp legacy ratio like `1.2` is clamped, not rejected).
 */
function migrateState(v: unknown): SplitState | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  if (typeof s.ratio !== "number" || !Number.isFinite(s.ratio)) return null;
  if (s.orientation !== "h" && s.orientation !== "v") return null;
  let mode: SplitMode;
  if (isMode(s.mode)) mode = s.mode;
  else if (typeof s.open === "boolean") mode = s.open ? "split" : "closed";
  else return null;
  return { mode, ratio: clampRatio(s.ratio), orientation: s.orientation };
}

/** Read persisted state for a session; default (closed) on absence/corruption. */
export function loadSplitState(sessionId: string): SplitState {
  if (!sessionId) return DEFAULT_SPLIT_STATE;
  try {
    const raw = globalThis.localStorage?.getItem(keyFor(sessionId));
    if (!raw) return DEFAULT_SPLIT_STATE;
    const parsed = JSON.parse(raw);
    const migrated = migrateState(parsed);
    if (!migrated) {
      console.error(`[split-state] discarding corrupt state for session ${sessionId}`);
      return DEFAULT_SPLIT_STATE;
    }
    return migrated;
  } catch (err) {
    console.error(`[split-state] failed to read state for session ${sessionId}`, err);
    return DEFAULT_SPLIT_STATE;
  }
}

/** Persist state; silently drops the write on quota/disabled storage. */
export function saveSplitState(sessionId: string, state: SplitState): void {
  if (!sessionId) return;
  try {
    globalThis.localStorage?.setItem(keyFor(sessionId), JSON.stringify(state));
  } catch (err) {
    console.warn(`[split-state] failed to persist state for session ${sessionId}`, err);
  }
}

/**
 * Session-scoped split state. Loads from `localStorage` on mount and on
 * `sessionId` change; persists on every change. The updater merges a partial
 * patch and clamps `ratio`.
 */
export function useSplitState(
  sessionId: string,
): [SplitState, (patch: Partial<SplitState>) => void] {
  const [state, setState] = useState<SplitState>(() => loadSplitState(sessionId));
  const prevSession = useRef(sessionId);

  useEffect(() => {
    if (prevSession.current !== sessionId) {
      prevSession.current = sessionId;
      setState(loadSplitState(sessionId));
      return;
    }
    saveSplitState(sessionId, state);
  }, [sessionId, state]);

  // Stable identity (functional setState → no deps) so consumers memoizing on
  // the updater don't churn every render. See change: split-editor-workspace.
  const update = useCallback((patch: Partial<SplitState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      if (patch.ratio !== undefined) next.ratio = clampRatio(patch.ratio);
      return next;
    });
  }, []);

  return [state, update];
}
