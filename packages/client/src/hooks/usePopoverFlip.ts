/**
 * usePopoverFlip — shared viewport-anchored popover positioning primitive.
 *
 * Measures a trigger button's bounding rect on open (and on resize/scroll while
 * open) and decides whether a popover should render below (default) or above
 * the trigger so it stays within the viewport, plus a clamped `maxHeight` so it
 * never overflows the screen edge — the list scrolls internally as a last
 * resort.
 *
 * Single source of truth retiring the hand-rolled `bottom-full` + `max-h-NN`
 * flip logic previously duplicated across ModelSelector / ThinkingLevelSelector
 * / CommandInput, and restoring the specced auto-flip on ChatViewMenu.
 *
 * See change: fix-popover-viewport-flip.
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
}

export interface PopoverFlipState {
  /** True → render the popover above the trigger (`bottom-full mb-1`). */
  flipUp: boolean;
  /** Clamped max height (px) for the popover in the chosen direction. */
  maxHeight: number;
}

/** Minimum popover height so it never collapses to nothing. */
export const MIN_POPOVER_HEIGHT = 120;
const DEFAULT_GAP = 8;
const DEFAULT_THRESHOLD = 200;

const CLOSED_STATE: PopoverFlipState = { flipUp: false, maxHeight: MIN_POPOVER_HEIGHT };

export function usePopoverFlip(
  triggerRef: React.RefObject<HTMLElement | null>,
  options: PopoverFlipOptions,
): PopoverFlipState {
  const { open, estimatedHeight = Infinity, gap = DEFAULT_GAP, threshold = DEFAULT_THRESHOLD } = options;
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
    setState({ flipUp, maxHeight });
  }, [triggerRef, estimatedHeight, gap, threshold]);

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
