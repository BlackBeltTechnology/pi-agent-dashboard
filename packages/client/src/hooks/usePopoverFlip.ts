/**
 * usePopoverFlip — shared viewport-anchored popover positioning primitive.
 *
 * Measures a trigger button's bounding rect on open (and on resize/scroll while
 * open) and decides whether a popover should render below (default) or above
 * the trigger so it stays within the viewport, plus a clamped `maxHeight` so it
 * never overflows the screen edge — the list scrolls internally as a last
 * resort.
 *
 * On the horizontal axis it additionally measures the trigger's left/right
 * viewport space and returns an `anchorRight` edge selection plus a clamped
 * `maxWidth`, so a right-anchored popover in a slim container flips toward the
 * side with room instead of clipping off-screen. The horizontal axis is
 * additive: it defaults to the consumer's existing right-anchor and only flips
 * when a finite `estimatedWidth` genuinely does not fit the anchored side.
 *
 * Single source of truth retiring the hand-rolled `bottom-full` + `max-h-NN`
 * flip logic previously duplicated across ModelSelector / ThinkingLevelSelector
 * / CommandInput, and restoring the specced auto-flip on ChatViewMenu.
 *
 * See change: fix-popover-viewport-flip.
 * See change: fix-popover-horizontal-flip.
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
  /** Gap between trigger and popover (≈ `mt-1`/`mb-1`). Default 8px. */
  gap?: number;
  /** Below-space (px) under which an up-flip is considered. Default 200px. */
  threshold?: number;
  /**
   * Approximate popover width in px. Used to decide when the anchored side is
   * too narrow to fit. Defaults to `Infinity` (unknown → never flip the
   * horizontal anchor, preserving the consumer's existing right-anchor).
   */
  estimatedWidth?: number;
}

export interface PopoverFlipState {
  /** True → render the popover above the trigger (`bottom-full mb-1`). */
  flipUp: boolean;
  /** Clamped max height (px) for the popover in the chosen direction. */
  maxHeight: number;
  /**
   * True → anchor the popover to the right edge (`right-0`, extends left);
   * false → anchor to the left edge (`left-0`, extends right). Defaults to
   * true (preserves the existing right-anchored consumers).
   */
  anchorRight: boolean;
  /** Clamped max width (px) for the popover in the chosen anchor direction. */
  maxWidth: number;
}

/** Minimum popover height so it never collapses to nothing. */
export const MIN_POPOVER_HEIGHT = 120;
/** Minimum popover width so it never collapses to nothing. */
export const MIN_POPOVER_WIDTH = 160;
const DEFAULT_GAP = 8;
const DEFAULT_THRESHOLD = 200;

const CLOSED_STATE: PopoverFlipState = {
  flipUp: false,
  maxHeight: MIN_POPOVER_HEIGHT,
  anchorRight: true,
  maxWidth: MIN_POPOVER_WIDTH,
};

export function usePopoverFlip(
  triggerRef: React.RefObject<HTMLElement | null>,
  options: PopoverFlipOptions,
): PopoverFlipState {
  const {
    open,
    estimatedHeight = Infinity,
    gap = DEFAULT_GAP,
    threshold = DEFAULT_THRESHOLD,
    estimatedWidth = Infinity,
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
    // Horizontal axis. Right-anchored (`right-0`) popovers extend leftward from
    // the trigger's right edge → available room is `rect.right`. Left-anchored
    // (`left-0`) popovers extend rightward from the trigger's left edge →
    // available room is `innerWidth - rect.left`. Preserve the right-anchor by
    // default; only flip when a finite estimated width does not fit the
    // right-anchor side AND the left-anchor side has more room.
    const spaceRightAnchor = rect.right - gap;
    const spaceLeftAnchor = window.innerWidth - rect.left - gap;
    const flipHorizontal =
      Number.isFinite(estimatedWidth) &&
      spaceRightAnchor < estimatedWidth &&
      spaceLeftAnchor > spaceRightAnchor;
    const anchorRight = !flipHorizontal;
    const maxWidth = Math.max(
      MIN_POPOVER_WIDTH,
      anchorRight ? spaceRightAnchor : spaceLeftAnchor,
    );
    setState({ flipUp, maxHeight, anchorRight, maxWidth });
  }, [triggerRef, estimatedHeight, gap, threshold, estimatedWidth]);

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
