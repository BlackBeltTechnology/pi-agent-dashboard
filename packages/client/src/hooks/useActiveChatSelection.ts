import { type RefObject, useEffect, useRef, useState } from "react";
import type { SelectionRowSpan } from "../lib/chat/chat-virtual-rows.js";

/**
 * Single source of truth for "the user is actively selecting transcript text"
 * (change: preserve-chat-selection-during-churn, D1).
 *
 * Subscribes to the document `selectionchange` event and exposes:
 *   - `isSelecting`: true while a non-collapsed `Selection` intersects the
 *     container — tested on BOTH the anchor and the focus endpoint (a
 *     cross-boundary drag whose anchor is outside but focus inside still
 *     counts), NOT anchor-containment alone.
 *   - `selectionSpanRef`: the selection's display-row span, recomputed via
 *     `mapRange` on every event WHILE the anchor row is still mounted and
 *     stored in a ref. This proactive capture is load-bearing: `rangeExtractor`
 *     reads this ref on every recompute (before any unmount), so selected rows
 *     never unmount and the live Range's endpoints never get moved to the
 *     spacer parent (DOM §live-range-pre-remove-steps is synchronous +
 *     irreversible). A reactive read-the-Range-after-churn path loses the race.
 *
 * The boolean flip is microtask-coalesced (a ref + a single `useState`) so a
 * drag-select firing `selectionchange` many times per frame does not thrash
 * React; the span ref updates synchronously so the extractor always sees the
 * latest span.
 *
 * `mapRange` MUST be referentially stable (wrap in `useCallback`); it is a
 * listener dependency.
 */
/** True when a non-collapsed selection has EITHER endpoint inside `container`. */
function selectionIntersects(container: HTMLElement, sel: Selection): boolean {
  if (sel.rangeCount === 0 || sel.isCollapsed) return false;
  const anchorIn = sel.anchorNode ? container.contains(sel.anchorNode) : false;
  const focusIn = sel.focusNode ? container.contains(sel.focusNode) : false;
  return anchorIn || focusIn;
}

export function useActiveChatSelection(
  containerRef: RefObject<HTMLElement | null>,
  mapRange: (range: Range) => SelectionRowSpan | null,
): { isSelecting: boolean; selectionSpanRef: RefObject<SelectionRowSpan | null> } {
  const [isSelecting, setIsSelecting] = useState(false);
  const selectionSpanRef = useRef<SelectionRowSpan | null>(null);
  const latestActiveRef = useRef(false);
  const flushPendingRef = useRef(false);

  useEffect(() => {
    const onSelectionChange = () => {
      const container = containerRef.current;
      const sel = typeof window !== "undefined" ? window.getSelection() : null;
      const active = !!(container && sel && selectionIntersects(container, sel));
      // Proactive capture while the anchor row is still mounted. `mapRange` may
      // actively clear the selection past the retained-row ceiling (returning
      // null), which fires another selectionchange that settles the boolean to
      // false on the next tick.
      selectionSpanRef.current = active ? mapRange((sel as Selection).getRangeAt(0)) : null;

      latestActiveRef.current = active;
      if (flushPendingRef.current) return;
      flushPendingRef.current = true;
      queueMicrotask(() => {
        flushPendingRef.current = false;
        setIsSelecting((prev) => (prev === latestActiveRef.current ? prev : latestActiveRef.current));
      });
    };

    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [containerRef, mapRange]);

  return { isSelecting, selectionSpanRef };
}
