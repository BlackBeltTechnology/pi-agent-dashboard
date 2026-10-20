/**
 * Drag-to-resize math shared by the split-workspace dividers.
 *
 * The outer chat/editor divider stores a fraction (0..1); the inner browse-rail
 * divider stores a clamped pixel width. This module holds the pure pointer→size
 * conversions. (The measuring hook was removed: the divider previews through the
 * DOM and commits once — see `useResizeDrag`.)
 *
 * See changes: split-editor-workspace, fix-split-divider-drag.
 */

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
