/**
 * Side placement for the session actions flyout: beside the card (not below or
 * above a trigger, so `usePopoverFlip` does not apply).
 *
 * Anchor mode — `left = card.right + GAP`, `top = card.top`.
 * Point mode  — the pointer's offset from the card's top-left is remembered at
 *   open and re-applied to the card's CURRENT rect, so a right-click menu stays
 *   anchored to its card and tracks scroll like an anchored one.
 * Both clamp inside the viewport (`MARGIN`); when there is no room to the right
 * the menu overlaps the card instead of leaving the viewport. `maxHeight` caps
 * the panel to the available space (any floor stays below that cap).
 *
 * Positions are written straight to the panel element's style through a ref —
 * never React state — so re-measuring on scroll / resize / card-resize does not
 * re-render the menu's content. See change: add-session-actions-flyout (D4).
 */
import { type RefObject, useLayoutEffect } from "react";

export const FLYOUT_GAP = 8;
export const FLYOUT_MARGIN = 8;

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface FlyoutPlacement {
  left: number;
  top: number;
  maxHeight: number;
}

/** Pure placement. `offset` set ⇒ point mode (offset from the card's top-left). */
export function computeSideFlyoutPosition(
  card: Rect,
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
  offset?: { dx: number; dy: number } | null,
): FlyoutPlacement {
  const maxLeft = Math.max(FLYOUT_MARGIN, viewport.width - FLYOUT_MARGIN - panel.width);
  let left = offset ? card.left + offset.dx : card.right + FLYOUT_GAP;
  let top = offset ? card.top + offset.dy : card.top;
  left = Math.min(Math.max(FLYOUT_MARGIN, left), maxLeft);
  const maxHeight = Math.max(0, viewport.height - 2 * FLYOUT_MARGIN);
  const height = Math.min(panel.height, maxHeight);
  const maxTop = Math.max(FLYOUT_MARGIN, viewport.height - FLYOUT_MARGIN - height);
  top = Math.min(Math.max(FLYOUT_MARGIN, top), maxTop);
  return { left: Math.round(left), top: Math.round(top), maxHeight };
}

interface Options {
  open: boolean;
  /** The card element the flyout is anchored to. */
  cardRef: RefObject<HTMLElement | null>;
  /** The flyout panel element. */
  panelRef: RefObject<HTMLElement | null>;
  /** Point mode: pointer position in viewport coordinates at open time. */
  point?: { x: number; y: number } | null;
}

export function useSideFlyoutPosition({ open, cardRef, panelRef, point }: Options): void {
  const px = point?.x;
  const py = point?.y;
  // biome-ignore lint/correctness/useExhaustiveDependencies: refs are stable; `px`/`py` capture the open-time pointer.
  useLayoutEffect(() => {
    if (!open) return;
    const card = cardRef.current;
    const panel = panelRef.current;
    if (!card || !panel) return;
    // The pointer offset is captured ONCE, against the card rect at open time.
    const base = card.getBoundingClientRect();
    const offset = px != null && py != null ? { dx: px - base.left, dy: py - base.top } : null;
    const place = () => {
      const c = cardRef.current;
      const p = panelRef.current;
      if (!c || !p) return;
      const rect = c.getBoundingClientRect();
      const next = computeSideFlyoutPosition(
        rect,
        { width: p.offsetWidth, height: p.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        offset,
      );
      p.style.left = `${next.left}px`;
      p.style.top = `${next.top}px`;
      p.style.maxHeight = `${next.maxHeight}px`;
      p.style.visibility = "visible";
    };
    place();
    // Scrolling INSIDE the menu must not reposition it (capture catches every
    // scroller, so filter the panel's own subtree out).
    const onScroll = (e: Event) => {
      const target = e.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      place();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    // The card's height changes while it streams.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
    ro?.observe(card);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
      ro?.disconnect();
    };
  }, [open, px, py]);
}
