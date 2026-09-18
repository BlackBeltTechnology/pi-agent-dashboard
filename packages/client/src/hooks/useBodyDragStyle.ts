/**
 * Body-level drag affordance for resize drags (`cursor` + `user-select: none`).
 *
 * `beginBodyDrag(cursor)` sets both on `document.body`; `endBodyDrag()` clears
 * them. Both are idempotent and gated on a private `active` ref: an instance
 * that never began a drag (or already ended one) never touches the body, so it
 * cannot clear a concurrent drag's overrides. The unmount cleanup ends an active
 * drag — an unmount mid-drag (breakpoint flip, panel collapse, session switch)
 * or a lost `mouseup` (pointer released outside the window) would otherwise
 * leave the page permanently `user-select: none`, killing text selection/copy.
 *
 * Converges the ad-hoc guarded cleanup `useTreeColumnWidth` carries (that hook
 * is not refactored onto this one — its effect also owns localStorage
 * persistence; future merge candidate).
 *
 * State lives in a ref, never setState: no re-render is needed, and the unmount
 * effect must not read render-time `document` styles.
 *
 * See change: fix-long-session-ux-degradation (§1, D1).
 */
import { useCallback, useEffect, useRef } from "react";

export interface BodyDragStyle {
  /** Sets the drag cursor + `user-select: none` on the body. */
  beginBodyDrag: (cursor: string) => void;
  /** Clears the body drag styles. Idempotent / no-op when not dragging. */
  endBodyDrag: () => void;
}

export function useBodyDragStyle(): BodyDragStyle {
  const active = useRef(false);

  const beginBodyDrag = useCallback((cursor: string) => {
    active.current = true;
    document.body.style.cursor = cursor;
    document.body.style.userSelect = "none";
  }, []);

  const endBodyDrag = useCallback(() => {
    // No-op when idle: a second mounted surface (or StrictMode's discarded
    // mount) must not clear a concurrently active drag's styles.
    if (!active.current) return;
    active.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  // Exactly one unmount cleanup; a no-op unless a drag was active.
  useEffect(() => endBodyDrag, [endBodyDrag]);

  return { beginBodyDrag, endBodyDrag };
}
