/**
 * Drag-to-resize math shared by the split-workspace dividers.
 *
 * The outer chat/editor divider stores a fraction (0..1); the inner browse-rail
 * divider stores a clamped pixel width. This module holds the pure pointer→size
 * conversions plus a hook that measures a container element on each drag frame.
 * Extracted from `ResizableSidebar`'s drag pattern.
 *
 * See change: split-editor-workspace.
 */

import { useCallback } from "react";
import { clampRatio, type SplitOrientation } from "./split-state.js";

export interface AxisRect {
  /** Left (h) or top (v) edge of the container, in client pixels. */
  start: number;
  /** Width (h) or height (v) of the container, in client pixels. */
  size: number;
}

/**
 * Convert a pointer client coordinate to a clamped split ratio. `h` reads
 * `clientX` against the container's left/width; `v` reads `clientY` against
 * top/height. A zero-size container yields the clamped default.
 */
export function ratioFromPointer(_orientation: SplitOrientation, clientPos: number, rect: AxisRect): number {
  if (rect.size <= 0) return clampRatio(0.5);
  return clampRatio((clientPos - rect.start) / rect.size);
}

/** Clamp a pixel width into `[min, max]`. */
export function clampWidth(width: number, min: number, max: number): number {
  if (!Number.isFinite(width)) return min;
  return Math.max(min, Math.min(max, width));
}

/**
 * Returns a callback that maps a pointer client coordinate to a clamped ratio,
 * measuring `containerRef` on each call, and forwards it to `onRatioChange`.
 */
export function useSplitRatio(
  containerRef: React.RefObject<HTMLElement | null>,
  orientation: SplitOrientation,
  onRatioChange: (ratio: number) => void,
): (clientPos: number) => void {
  return useCallback(
    (clientPos: number) => {
      const el = containerRef.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      const rect: AxisRect =
        orientation === "h" ? { start: box.left, size: box.width } : { start: box.top, size: box.height };
      onRatioChange(ratioFromPointer(orientation, clientPos, rect));
    },
    [containerRef, orientation, onRatioChange],
  );
}
