import type React from "react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

export interface ZoomPanState {
  scale: number;
  translateX: number;
  translateY: number;
}

export interface UseZoomPanOptions {
  minScale?: number;
  maxScale?: number;
  zoomStep?: number;
  /**
   * Scale the surface starts at and that reset / double-click return to.
   * Clamped into [minScale, maxScale]; defaults to 1. While the user has not
   * interacted, a changed value re-seeds the view (fit may resolve async).
   * See change: fix-markdown-remount-storm (D4).
   */
  initialScale?: number;
}

const DEFAULT_MIN = 0.5;
const DEFAULT_MAX = 4;
const DEFAULT_STEP = 1.2;
const WHEEL_SENSITIVITY = 0.002;
// Pointer must move more than this (CSS px) before a press becomes a pan.
// Below it, the press stays a click so child onClick handlers fire (capturing
// on pointerdown would retarget the pointerup → click to the container).
const DRAG_THRESHOLD = 4;

export function useZoomPan(options?: UseZoomPanOptions) {
  const minScale = options?.minScale ?? DEFAULT_MIN;
  const maxScale = options?.maxScale ?? DEFAULT_MAX;
  const zoomStep = options?.zoomStep ?? DEFAULT_STEP;

  const initialScale = Math.min(maxScale, Math.max(minScale, options?.initialScale ?? 1));

  const [state, rawSetState] = useState<ZoomPanState>({ scale: initialScale, translateX: 0, translateY: 0 });
  // True once the user zoomed/panned; a late initialScale change must not override that.
  const touched = useRef(false);
  const setState = useCallback((u: React.SetStateAction<ZoomPanState>) => {
    touched.current = true;
    rawSetState(u);
  }, []);
  const resetToInitial = useCallback(() => {
    touched.current = false;
    rawSetState({ scale: initialScale, translateX: 0, translateY: 0 });
  }, [initialScale]);

  useLayoutEffect(() => {
    if (!touched.current) rawSetState({ scale: initialScale, translateX: 0, translateY: 0 });
  }, [initialScale]);

  // Refs for drag tracking (avoid re-renders during drag)
  const dragging = useRef(false);
  // Press recorded on pointerdown but not yet promoted to a drag (capture
  // deferred until movement exceeds DRAG_THRESHOLD). Null when idle/dragging.
  const pendingStart = useRef<{ x: number; y: number } | null>(null);
  const lastPointer = useRef({ x: 0, y: 0 });
  // Pinch tracking
  const pinchDist = useRef<number | null>(null);
  const pinchMid = useRef({ x: 0, y: 0 });

  const clampScale = useCallback(
    (s: number) => Math.min(maxScale, Math.max(minScale, s)),
    [minScale, maxScale],
  );

  /**
   * Zoom centered on a point (in container-local coords).
   */
  const zoomAt = useCallback(
    (cx: number, cy: number, factor: number) => {
      setState((prev) => {
        const newScale = clampScale(prev.scale * factor);
        if (newScale === prev.scale) return prev;
        const ratio = newScale / prev.scale;
        return {
          scale: newScale,
          translateX: cx - ratio * (cx - prev.translateX),
          translateY: cy - ratio * (cy - prev.translateY),
        };
      });
    },
    [clampScale, setState],
  );

  // ── Wheel handler ──────────────────────────────────────────────────
  const onWheel = useCallback(
    (e: React.WheelEvent | WheelEvent) => {
      e.preventDefault();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * WHEEL_SENSITIVITY);
      zoomAt(cx, cy, factor);
    },
    [zoomAt],
  );

  // ── Pointer (drag) handlers ────────────────────────────────────────
  const onPointerDown = useCallback((e: React.PointerEvent | PointerEvent) => {
    // Only primary button
    if (e.button !== 0) return;
    // Record the press; do NOT capture yet. Capture is deferred to the move
    // handler so a click-without-drag reaches the element under the pointer.
    pendingStart.current = { x: e.clientX, y: e.clientY };
    lastPointer.current = { x: e.clientX, y: e.clientY };
    dragging.current = false;
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent | PointerEvent) => {
    if (!dragging.current) {
      const start = pendingStart.current;
      if (!start) return;
      const ddx = e.clientX - start.x;
      const ddy = e.clientY - start.y;
      // Below threshold → still a potential click; don't pan, don't capture.
      if (ddx * ddx + ddy * ddy <= DRAG_THRESHOLD * DRAG_THRESHOLD) return;
      // Threshold crossed → promote to a drag and capture once. lastPointer is
      // still the pointerdown point, so the first translate applies the full
      // accumulated delta (no jump, no lost motion).
      dragging.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    const dx = e.clientX - lastPointer.current.x;
    const dy = e.clientY - lastPointer.current.y;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    setState((prev) => ({
      ...prev,
      translateX: prev.translateX + dx,
      translateY: prev.translateY + dy,
    }));
  }, [setState]);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
    pendingStart.current = null;
  }, []);

  // ── Touch (pinch) handler ──────────────────────────────────────────
  const onTouchMove = useCallback(
    (e: React.TouchEvent | TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const mx = (t0.clientX + t1.clientX) / 2 - rect.left;
      const my = (t0.clientY + t1.clientY) / 2 - rect.top;

      if (pinchDist.current != null) {
        const factor = dist / pinchDist.current;
        zoomAt(mx, my, factor);
      }
      pinchDist.current = dist;
      pinchMid.current = { x: mx, y: my };
    },
    [zoomAt],
  );

  const onTouchEnd = useCallback(() => {
    pinchDist.current = null;
  }, []);

  // ── Double-click reset ─────────────────────────────────────────────
  const onDoubleClick = resetToInitial;

  // ── Button controls ────────────────────────────────────────────────
  const zoomIn = useCallback(() => {
    setState((prev) => {
      const newScale = clampScale(prev.scale * zoomStep);
      return { ...prev, scale: newScale };
    });
  }, [clampScale, zoomStep, setState]);

  const zoomOut = useCallback(() => {
    setState((prev) => {
      const newScale = clampScale(prev.scale / zoomStep);
      return { ...prev, scale: newScale };
    });
  }, [clampScale, zoomStep, setState]);

  const reset = resetToInitial;

  const handlers = {
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onTouchMove,
    onTouchEnd,
    onDoubleClick,
  };

  return { state, handlers, zoomIn, zoomOut, reset, initialScale };
}
