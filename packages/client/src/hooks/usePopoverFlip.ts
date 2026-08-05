/**
 * usePopoverFlip — shared viewport-anchored popover positioning primitive.
 *
 * Measures a trigger button's bounding rect on open (and on resize/scroll while
 * open) and decides whether a popover should render below (default) or above
 * the trigger so it stays within the viewport, plus a clamped `maxHeight` so it
 * never overflows the screen edge — the list scrolls internally as a last
 * resort.
 *
 * Height comes back as TWO independent values and consumers MUST apply both:
 *   - `maxHeight` is the BOUND: the available space in the chosen direction,
 *     never inflated by any floor (a floor applied after clamping can exceed
 *     the space it was clamped to and push the popover past the boundary edge).
 *   - `minHeight` is the FLOOR: `min(minPopoverHeight, availableSpace)` — it
 *     raises a short popover to a readable height but can never exceed the
 *     bound. When space is below the floor the two collapse onto each other.
 * The popover's rendered height is then its natural content height clamped
 * between them, performed by the browser during normal layout: apply both as
 * styles on a box whose content region carries `overflow-y-auto`. Nothing here
 * measures content — the measure path runs on every window `resize`/`scroll`
 * plus boundary `scroll`/`ResizeObserver`, so reading a content metric like
 * `scrollHeight` would force a reflow on every scroll frame. It stays pure rect
 * arithmetic.
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
 * When a `boundaryRef` is supplied, space is measured against that clipping
 * pane's rect (BOTH axes) instead of the viewport, so a popover nested in an
 * offset `overflow` pane no longer clips against the pane edge; it also
 * re-measures on the boundary's own `scroll` / `ResizeObserver` (an
 * internally-scrolling pane or a dragged split-divider fires neither window
 * event). `preferredAnchor` lets a `left-0` consumer opt into the horizontal
 * axis without silently flipping to `right-0`, and `minContentWidth` flips
 * instead of squishing a dense dropdown below readability.
 *
 * See change: fix-popover-viewport-flip.
 * See change: fix-popover-horizontal-flip.
 * See change: fix-popover-container-clip.
 * See change: fix-popover-pane-bounded-height.
 */
import { useCallback, useLayoutEffect, useState } from "react";

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
  /**
   * Clipping boundary. When set, space is measured against its rect (BOTH
   * axes) instead of the viewport, and the hook re-measures on the boundary's
   * own `scroll` + `ResizeObserver`. Default: viewport (backward-compatible).
   */
  boundaryRef?: React.RefObject<HTMLElement | null>;
  /**
   * Anchor the consumer prefers to keep. Default `"right"` (current behavior).
   * A `"left"` consumer stays `left-0` unless it genuinely must flip.
   */
  preferredAnchor?: "left" | "right";
  /**
   * Below this content width, FLIP to the other side instead of clamping
   * `maxWidth` (so a dense dropdown is never squished below readability); only
   * when neither side fits does it clamp. Default 0 (no minimum).
   */
  minContentWidth?: number;
  /**
   * Readable-height floor returned as `minHeight` (itself capped by available
   * space). Per-consumer rather than global: filterable list popovers want a
   * generous floor (≈260) while short fixed menus would render dead space at
   * that height. Default `MIN_POPOVER_HEIGHT`.
   * See change: fix-popover-pane-bounded-height (Decision 6).
   */
  minPopoverHeight?: number;
}

export interface PopoverFlipState {
  /** True → render the popover above the trigger (`bottom-full mb-1`). */
  flipUp: boolean;
  /**
   * BOUND: available space (px) in the chosen direction. Never inflated by the
   * floor, so applying it can never push the popover past the boundary edge.
   */
  maxHeight: number;
  /**
   * FLOOR: `min(minPopoverHeight, maxHeight)`. Apply alongside `maxHeight` —
   * a consumer that applies only `maxHeight` silently loses its minimum height.
   */
  minHeight: number;
  /**
   * True → anchor the popover to the right edge (`right-0`, extends left);
   * false → anchor to the left edge (`left-0`, extends right). Defaults to
   * true (preserves the existing right-anchored consumers).
   */
  anchorRight: boolean;
  /** Clamped max width (px) for the popover in the chosen anchor direction. */
  maxWidth: number;
}

/** Default readable-height floor (`minHeight`) so a popover is never a sliver. */
export const MIN_POPOVER_HEIGHT = 120;
/** Floor for filterable list popovers, which read as cramped at the default. */
export const LIST_POPOVER_MIN_HEIGHT = 260;
/** Minimum popover width so it never collapses to nothing. */
export const MIN_POPOVER_WIDTH = 160;
const DEFAULT_GAP = 8;
const DEFAULT_THRESHOLD = 200;

const CLOSED_STATE: PopoverFlipState = {
  flipUp: false,
  maxHeight: MIN_POPOVER_HEIGHT,
  // A closed popover renders nothing, so it asserts no floor.
  minHeight: 0,
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
    boundaryRef,
    preferredAnchor = "right",
    minContentWidth = 0,
    minPopoverHeight = MIN_POPOVER_HEIGHT,
  } = options;
  const [state, setState] = useState<PopoverFlipState>(CLOSED_STATE);

  const measure = useCallback(() => {
    if (typeof window === "undefined") return;
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Clipping boundary: measure against the supplied pane's rect (both axes)
    // when present, else the viewport. Absent boundary → 0..innerWidth /
    // 0..innerHeight, byte-for-byte the previous viewport behavior.
    const boundary = boundaryRef?.current ?? null;
    // Dev-only self-boundary guard: the boundary must be an ancestor PANE of
    // the trigger, never the popover's own `overflow-y-auto` wrapper (a sibling
    // of the trigger). A boundary that does not contain the trigger would clamp
    // the popover against itself.
    if (
      import.meta.env.DEV &&
      boundary &&
      typeof boundary.contains === "function" &&
      !boundary.contains(el)
    ) {
      console.warn(
        "usePopoverFlip: boundaryRef does not contain the trigger — it must be " +
          "the clipping pane, not the popover's own overflow wrapper.",
      );
    }
    const b = boundary?.getBoundingClientRect();
    const leftEdge = b ? b.left : 0;
    const rightEdge = b ? b.right : window.innerWidth;
    const topEdge = b ? b.top : 0;
    const bottomEdge = b ? b.bottom : window.innerHeight;

    const spaceBelow = bottomEdge - rect.bottom - gap;
    const spaceAbove = rect.top - topEdge - gap;
    const flipUp = spaceBelow < Math.min(estimatedHeight, threshold) && spaceAbove > spaceBelow;
    // The bound is the raw available space. `Math.max(0, …)` only guards the
    // degenerate case where the trigger has scrolled outside the boundary in
    // both directions: a negative CSS `max-height` is invalid and would be
    // dropped by the browser, leaving the popover unbounded — the very failure
    // this bound exists to prevent. It never inflates a real space.
    const maxHeight = Math.max(0, flipUp ? spaceAbove : spaceBelow);
    // The floor can never exceed the bound, so it can never cause overflow.
    const minHeight = Math.min(minPopoverHeight, maxHeight);

    // Horizontal axis. Right-anchored (`right-0`) popovers extend leftward from
    // the trigger's right edge → room is `rect.right - leftEdge`. Left-anchored
    // (`left-0`) popovers extend rightward from the trigger's left edge → room
    // is `rightEdge - rect.left`. The preferred side stays unless it cannot fit
    // `estimatedWidth`/`minContentWidth` AND the other side has more room.
    const spaceRightAnchor = rect.right - gap - leftEdge;
    const spaceLeftAnchor = rightEdge - rect.left - gap;
    const preferLeft = preferredAnchor === "left";
    const preferredSpace = preferLeft ? spaceLeftAnchor : spaceRightAnchor;
    const otherSpace = preferLeft ? spaceRightAnchor : spaceLeftAnchor;
    const fitThreshold = Math.max(
      Number.isFinite(estimatedWidth) ? estimatedWidth : 0,
      minContentWidth,
    );
    const flipHorizontal =
      fitThreshold > 0 && preferredSpace < fitThreshold && otherSpace > preferredSpace;
    const anchorRight = preferLeft ? flipHorizontal : !flipHorizontal;
    const chosenSpace = flipHorizontal ? otherSpace : preferredSpace;
    const maxWidth = Math.max(MIN_POPOVER_WIDTH, chosenSpace);
    setState({ flipUp, maxHeight, minHeight, anchorRight, maxWidth });
  }, [triggerRef, boundaryRef, estimatedHeight, gap, threshold, estimatedWidth, preferredAnchor, minContentWidth, minPopoverHeight]);

  // Measure BEFORE paint (layout effect): a plain effect paints one frame at the
  // initial CLOSED_STATE (right-0, 160px floor) before the corrected anchor/size
  // lands, which both flickers for users and lets a rect read observe the wrong
  // position. See change: fix-popover-container-clip.
  useLayoutEffect(() => {
    if (!open || typeof window === "undefined") return;
    measure();
    window.addEventListener("resize", measure, { passive: true });
    window.addEventListener("scroll", measure, { passive: true, capture: true });
    // Boundary staleness: an internally-scrolling pane or a split-divider drag
    // fires neither window `resize` nor `scroll`, so also watch the boundary
    // itself. `ResizeObserver` on the single supplied element is scoped, not the
    // rejected ancestor-walk.
    const boundary = boundaryRef?.current ?? null;
    let ro: ResizeObserver | undefined;
    if (boundary) {
      boundary.addEventListener("scroll", measure, { passive: true });
      if (typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(() => measure());
        ro.observe(boundary);
      }
    }
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, { capture: true } as EventListenerOptions);
      if (boundary) {
        boundary.removeEventListener("scroll", measure);
        ro?.disconnect();
      }
    };
  }, [open, measure, boundaryRef]);

  return open ? state : CLOSED_STATE;
}
