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
 *   - `isSelectingRef`: the same boolean, published **synchronously** inside the
 *     listener (change: anchor-chat-selection-against-row-growth, D6). Consumers
 *     that run OUTSIDE React's render cycle — notably the virtualizer
 *     `onChange` bottom-pin — must read this, not a render-time mirror of the
 *     debounced state: that mirror lands only after a `queueMicrotask` AND a
 *     render, and a chunk arriving inside that window still executes
 *     `el.scrollTop = el.scrollHeight`. One invariant, one clock.
 *   - `selectionAnchorRef`: the transcript row element the drag STARTED in
 *     (D4), captured on the collapsed→non-collapsed transition and held until
 *     collapse. Held as an `Element`, never a `data-index` — an insertion above
 *     renumbers indices, which is the same silent-retarget bug being fixed.
 *     `null` for a cross-boundary drag whose anchor is outside the container.
 *
 * The boolean flip is microtask-coalesced (a ref + a single `useState`) so a
 * drag-select firing `selectionchange` many times per frame does not thrash
 * React; the span ref updates synchronously so the extractor always sees the
 * latest span. The debounced `isSelecting` **state** is retained unchanged —
 * render-driven effects (the tail freeze, the sticky-bottom layout effect) need
 * the re-render and the →false edge. Ref for out-of-render guards, state for
 * render-driven effects.
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

/**
 * The `[data-index]` virtual row owning a selection endpoint, or `null` when the
 * node is outside the transcript container. Walks up from a text node via
 * `parentElement`, since `closest` is an `Element` method.
 */
function rowElementFor(container: HTMLElement, node: Node | null): HTMLElement | null {
  if (!node || !container.contains(node)) return null;
  const start = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const row = start?.closest("[data-index]") ?? null;
  return row && container.contains(row) ? (row as HTMLElement) : null;
}

/**
 * D4 anchor bookkeeping: the drag-origin row is captured ONCE, on the
 * collapsed→non-collapsed transition, and released on collapse. Re-capturing on
 * later events would let the anchor follow the pointer, which is circular — the
 * whole point is that it does not move.
 */
function nextAnchor(
  current: HTMLElement | null,
  active: boolean,
  container: HTMLElement | null,
  sel: Selection | null,
): HTMLElement | null {
  if (!active) return null;
  if (current) return current;
  return container && sel ? rowElementFor(container, sel.anchorNode) : null;
}

export function useActiveChatSelection(
  containerRef: RefObject<HTMLElement | null>,
  mapRange: (range: Range) => SelectionRowSpan | null,
): {
  isSelecting: boolean;
  isSelectingRef: RefObject<boolean>;
  selectionSpanRef: RefObject<SelectionRowSpan | null>;
  selectionAnchorRef: RefObject<HTMLElement | null>;
} {
  const [isSelecting, setIsSelecting] = useState(false);
  const selectionSpanRef = useRef<SelectionRowSpan | null>(null);
  const isSelectingRef = useRef(false);
  const selectionAnchorRef = useRef<HTMLElement | null>(null);
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

      // D6: publish the boolean on the SAME clock as the span, for guards that
      // run outside render. Must not wait on the microtask debounce below.
      isSelectingRef.current = active;

      // D4: pin the drag-origin row (see `nextAnchor`).
      selectionAnchorRef.current = nextAnchor(selectionAnchorRef.current, active, container, sel);

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

  return { isSelecting, isSelectingRef, selectionSpanRef, selectionAnchorRef };
}
