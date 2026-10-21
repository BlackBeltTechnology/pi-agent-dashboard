/**
 * Shared drag lifecycle for the resize affordances (split divider, browse rail,
 * session sidebar seam, diff tree handle).
 *
 * Pointer-event based: starts on a primary `pointerdown`, previews at most once
 * per animation frame, and ends on the first of `pointerup` / `pointercancel` /
 * `lostpointercapture` / a `pointermove` reporting `buttons === 0` (a release the
 * page never saw). A transparent full-viewport shield (`z-lightbox` token) mounts
 * on the first moved move so iframes cannot swallow move/release. Unmount tears
 * everything down WITHOUT calling `onEnd` (nothing committed into a dying tree).
 * Composes `useBodyDragStyle` (cursor + `user-select: none`).
 *
 * See change: fix-split-divider-drag (design D1–D4, D7).
 */
import type React from "react";
import { useCallback, useEffect, useRef } from "react";
import { useBodyDragStyle } from "./useBodyDragStyle.js";

export interface ResizeDragOptions {
  /** Which client coordinate to report. */
  axis: "x" | "y";
  /** Body + shield cursor. */
  cursor: string;
  onStart?: () => void;
  /** Live preview, at most once per animation frame. */
  onPreview: (clientPos: number) => void;
  /** Drag ended. Last previewed (or release) position; `null` = nothing to commit. */
  onEnd: (clientPos: number | null) => void;
}

interface Session {
  /** Release listeners, pending frame and shield. Idempotent; never calls callbacks. */
  teardown: () => void;
}

// One drag at a time across all instances. Holds the owning instance's token so
// an unrelated instance's unmount never frees someone else's drag.
let activeOwner: symbol | null = null;

interface DragContext {
  handle: Element;
  pointerId: number;
  startPos: number;
  coord: (ev: { clientX: number; clientY: number }) => number;
  opts: { current: ResizeDragOptions };
  /** Ends the drag (teardown + body/slot release) and reports `pos` to `onEnd`. */
  finish: (pos: number | null) => void;
}

/** Attach the window/handle listeners for one drag; returns its teardown. */
function runDrag(c: DragContext): Session {
  let moved = false;
  let latest = c.startPos;
  let previewed: number | null = null;
  let raf: number | null = null;
  let shield: HTMLElement | null = null;

  const cancelFrame = () => {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
  };
  // pointercancel / lostpointercapture / buttons===0: the pending frame was
  // never seen by the user, so commit only what was previewed.
  const finishLost = () => c.finish(previewed);

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== c.pointerId) return;
    if (ev.buttons === 0) return finishLost();
    const pos = c.coord(ev);
    if (!moved) {
      if (pos === c.startPos) return;
      moved = true;
      shield = mountShield(c.opts.current.cursor);
    }
    latest = pos;
    if (raf === null) {
      raf = requestAnimationFrame(() => {
        raf = null;
        previewed = latest;
        c.opts.current.onPreview(latest);
      });
    }
  };
  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== c.pointerId) return;
    if (!moved) return c.finish(null);
    cancelFrame();
    const pos = c.coord(ev);
    c.opts.current.onPreview(pos);
    c.finish(pos);
  };
  const onCancel = (ev: PointerEvent) => {
    if (ev.pointerId === c.pointerId) finishLost();
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  c.handle.addEventListener("lostpointercapture", finishLost);

  return {
    teardown: () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      c.handle.removeEventListener("lostpointercapture", finishLost);
      cancelFrame();
      shield?.remove();
      try {
        c.handle.releasePointerCapture?.(c.pointerId);
      } catch {
        // already released
      }
    },
  };
}

export function useResizeDrag(options: ResizeDragOptions): {
  onPointerDown: React.PointerEventHandler;
  onMouseDown: React.MouseEventHandler;
} {
  const opts = useRef(options);
  opts.current = options;
  const { beginBodyDrag, endBodyDrag } = useBodyDragStyle();
  const owner = useRef<symbol>(Symbol("resize-drag"));
  const session = useRef<Session | null>(null);

  /** Release every resource the drag holds. Idempotent. Never calls callbacks. */
  const dispose = useCallback(() => {
    const s = session.current;
    if (!s) return;
    session.current = null;
    s.teardown();
    endBodyDrag();
    if (activeOwner === owner.current) activeOwner = null;
  }, [endBodyDrag]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 || activeOwner !== null || session.current) return;
      const axis = opts.current.axis;
      const handle = e.currentTarget as Element;
      const pointerId = e.pointerId;

      activeOwner = owner.current;
      beginBodyDrag(opts.current.cursor);
      try {
        handle.setPointerCapture?.(pointerId);
      } catch {
        // Capture is best-effort; the shield covers the lost-capture case.
      }
      const coord = (ev: { clientX: number; clientY: number }) => (axis === "x" ? ev.clientX : ev.clientY);
      session.current = runDrag({
        handle,
        pointerId,
        startPos: coord(e),
        coord,
        opts,
        finish: (pos) => {
          dispose();
          opts.current.onEnd(pos);
        },
      });
      opts.current.onStart?.();
    },
    [beginBodyDrag, dispose],
  );

  // Focus-preserving: pressing the handle must not steal focus from the composer/editor.
  const onMouseDown = useCallback((e: React.MouseEvent) => e.preventDefault(), []);

  // Unmount mid-drag: tear down, commit nothing (D7).
  useEffect(() => dispose, [dispose]);

  return { onPointerDown, onMouseDown };
}

function mountShield(cursor: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "fixed inset-0 z-lightbox";
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("data-testid", "resize-drag-shield");
  el.style.touchAction = "none";
  el.style.cursor = cursor;
  document.body.appendChild(el);
  return el;
}
