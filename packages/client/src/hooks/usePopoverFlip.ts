/**
 * usePopoverFlip — shared viewport-anchored popover positioning primitive.
 *
 * Measures a trigger button's bounding rect on open (and on resize/scroll while
 * open) and decides:
 *  - vertical: below (default) or above so it stays within the viewport, plus
 *    a clamped `maxHeight` so the list scrolls internally as a last resort
 *  - horizontal: right-align (`right-0`, legacy default) or left-align (`left-0`)
 *    when a right-aligned panel would hang past the left viewport edge
 *
 * Single source of truth retiring the hand-rolled `bottom-full` + `max-h-NN`
 * flip logic previously duplicated across ModelSelector / ThinkingLevelSelector
 * / CommandInput, and restoring the specced auto-flip on ChatViewMenu.
 *
 * See change: fix-popover-viewport-flip.
 * Horizontal arm: ChatViewMenu StatusBar-leading clip on mobile (right-0 + w-64
 * from a left-edge trigger hangs off-screen; MobileShell overflow-hidden clips it).
 */
import { useCallback, useEffect, useState } from "react";

export interface PopoverFlipOptions {
  /** Whether the popover is open. No measurement / listeners while false. */
  open: boolean;
  /**
   * Approximate popover height in px. Used to decide when below-space is too
   * short to fit. Defaults to `Infinity` (unknown → flip whenever below-space
   * dips under `threshold`).
   */
  estimatedHeight?: number;
  /**
   * Approximate popover width in px. Used for horizontal alignment. When
   * omitted / `Infinity`, `alignRight` stays `true` (legacy default) so
   * call sites that only care about vertical flip keep current behavior.
   */
  estimatedWidth?: number;
  /** Gap between trigger and popover (≈ `mt-1`/`mb-1`). Default 8px. */
  gap?: number;
  /** Below-space (px) under which an up-flip is considered. Default 200px. */
  threshold?: number;
  /** Horizontal margin from the viewport edge. Default 8px. */
  edgeMargin?: number;
}

export interface PopoverFlipState {
  /** True → render the popover above the trigger (`bottom-full mb-1`). */
  flipUp: boolean;
  /** Clamped max height (px) for the popover in the chosen direction. */
  maxHeight: number;
  /**
   * True → `right-0` (popover right edge aligns to trigger right edge).
   * False → `left-0`. Defaults true when width is unknown.
   */
  alignRight: boolean;
}

/** Minimum popover height so it never collapses to nothing. */
export const MIN_POPOVER_HEIGHT = 120;
const DEFAULT_GAP = 8;
const DEFAULT_THRESHOLD = 200;
const DEFAULT_EDGE_MARGIN = 8;

const CLOSED_STATE: PopoverFlipState = {
  flipUp: false,
  maxHeight: MIN_POPOVER_HEIGHT,
  alignRight: true,
};

/**
 * Pure horizontal placement: prefer right-align (legacy) unless that would
 * place any part of the popover left of the viewport margin.
 */
export function chooseHorizontalAlign(opts: {
  triggerRight: number;
  triggerLeft: number;
  viewportWidth: number;
  estimatedWidth: number;
  edgeMargin?: number;
}): boolean {
  const margin = opts.edgeMargin ?? DEFAULT_EDGE_MARGIN;
  const width = opts.estimatedWidth;
  if (!Number.isFinite(width) || width <= 0) return true;

  const rightAlignedLeft = opts.triggerRight - width;
  // Prefer right-0 when the full width fits on-screen.
  if (rightAlignedLeft >= margin) return true;

  const leftAlignedRight = opts.triggerLeft + width;
  // Prefer left-0 when that keeps the panel on-screen (or at least better).
  if (leftAlignedRight <= opts.viewportWidth - margin) return false;

  // Both overflow: pick the side that keeps more of the panel visible.
  const rightVisible = Math.min(opts.triggerRight, opts.viewportWidth) - Math.max(rightAlignedLeft, 0);
  const leftVisible = Math.min(leftAlignedRight, opts.viewportWidth) - Math.max(opts.triggerLeft, 0);
  return rightVisible >= leftVisible;
}

export function usePopoverFlip(
  triggerRef: React.RefObject<HTMLElement | null>,
  options: PopoverFlipOptions,
): PopoverFlipState {
  const {
    open,
    estimatedHeight = Infinity,
    estimatedWidth = Infinity,
    gap = DEFAULT_GAP,
    threshold = DEFAULT_THRESHOLD,
    edgeMargin = DEFAULT_EDGE_MARGIN,
  } = options;
  const [state, setState] = useState<PopoverFlipState>(CLOSED_STATE);

  const measure = useCallback(() => {
    if (typeof window === "undefined") return;
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const spaceAbove = rect.top - gap;
    const flipUp = spaceBelow < Math.min(estimatedHeight, threshold) && spaceAbove > spaceBelow;
    const maxHeight = Math.max(MIN_POPOVER_HEIGHT, flipUp ? spaceAbove : spaceBelow);
    const alignRight = chooseHorizontalAlign({
      triggerRight: rect.right,
      triggerLeft: rect.left,
      viewportWidth: window.innerWidth,
      estimatedWidth,
      edgeMargin,
    });
    setState({ flipUp, maxHeight, alignRight });
  }, [triggerRef, estimatedHeight, estimatedWidth, gap, threshold, edgeMargin]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    measure();
    window.addEventListener("resize", measure, { passive: true });
    window.addEventListener("scroll", measure, { passive: true, capture: true });
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, { capture: true } as EventListenerOptions);
    };
  }, [open, measure]);

  return open ? state : CLOSED_STATE;
}
