import { useRef, useEffect, useCallback, useState } from "react";

interface SwipeBackOptions {
  /** Enable/disable the gesture */
  enabled: boolean;
  /** Called when swipe completes */
  onBack: () => void;
  /** Left-edge activation zone in px (default 40) */
  edgeZone?: number;
  /** Threshold fraction of screen width to trigger (default 0.4) */
  threshold?: number;
}

interface SwipeState {
  /** Current swipe offset in px (0 when not swiping) */
  offset: number;
  /** Whether a swipe is in progress */
  swiping: boolean;
}

const EDITABLE_SELECTOR = 'input, textarea, [contenteditable]:not([contenteditable="false"])';

/**
 * True when a non-collapsed text selection exists on the page and it is NOT a
 * selection inside an editable field (change: keep-oversized-chat-selection, D6).
 * A selection in a field is the user editing, not reading; `activeElement` is
 * checked as well because some engines report a field's selection with its
 * anchor on the field's PARENT.
 */
function hasPageTextSelection(): boolean {
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
  const active = document.activeElement;
  if (active?.closest?.(EDITABLE_SELECTOR)) return false;
  const anchor = sel.anchorNode;
  const anchorEl = anchor?.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : (anchor?.parentElement ?? null);
  return !anchorEl?.closest?.(EDITABLE_SELECTOR);
}

/**
 * Hook for iOS-style left-edge swipe-back gesture.
 * Returns a ref to attach to the container and the current swipe offset.
 *
 * Yields to a held page text selection: dragging a selection handle near the
 * left edge must never navigate back or `preventDefault` the handle drag. The
 * guard reads the global selection, so it needs no coupling to `ChatView`.
 */
export function useSwipeBack({ enabled, onBack, edgeZone = 40, threshold = 0.4 }: SwipeBackOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [swipeState, setSwipeState] = useState<SwipeState>({ offset: 0, swiping: false });

  // Refs for tracking touch without re-renders during move
  const trackingRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const currentOffsetRef = useRef(0);
  const decidedRef = useRef(false); // whether we've decided horizontal vs vertical
  const isHorizontalRef = useRef(false);

  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!enabled) return;

    function handleTouchStart(e: TouchEvent) {
      const touch = e.touches[0];
      if (!touch || touch.clientX > edgeZone) return;
      // A held text selection means the touch is a handle drag: never start.
      if (hasPageTextSelection()) {
        trackingRef.current = false;
        return;
      }
      trackingRef.current = true;
      decidedRef.current = false;
      isHorizontalRef.current = false;
      startXRef.current = touch.clientX;
      startYRef.current = touch.clientY;
      currentOffsetRef.current = 0;
    }

    function handleTouchMove(e: TouchEvent) {
      if (!trackingRef.current) return;
      // FIRST on every move, before direction is decided and before any
      // preventDefault: a long-press selection forms before the horizontal
      // decision, so it is seen in time. Fully reset and let the page scroll.
      if (hasPageTextSelection()) {
        trackingRef.current = false;
        decidedRef.current = false;
        isHorizontalRef.current = false;
        currentOffsetRef.current = 0;
        setSwipeState({ offset: 0, swiping: false });
        return;
      }
      const touch = e.touches[0];
      if (!touch) return;

      const dx = touch.clientX - startXRef.current;
      const dy = touch.clientY - startYRef.current;

      // Decide direction after 10px of movement
      if (!decidedRef.current) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 10) return;
        decidedRef.current = true;
        isHorizontalRef.current = Math.abs(dx) > Math.abs(dy);
        if (isHorizontalRef.current) {
          setSwipeState({ offset: 0, swiping: true });
        }
      }

      if (!isHorizontalRef.current) {
        trackingRef.current = false;
        return;
      }

      // Prevent vertical scroll while swiping
      e.preventDefault();
      const offset = Math.max(0, dx);
      currentOffsetRef.current = offset;
      setSwipeState({ offset, swiping: true });
    }

    function handleTouchEnd() {
      if (!trackingRef.current || !isHorizontalRef.current) {
        trackingRef.current = false;
        return;
      }
      trackingRef.current = false;

      const screenWidth = window.innerWidth;
      const triggered = currentOffsetRef.current > screenWidth * threshold;

      setSwipeState({ offset: 0, swiping: false });

      if (triggered) {
        onBackRef.current();
      }
    }

    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchend", handleTouchEnd, { passive: true });
    document.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
      document.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [enabled, edgeZone, threshold]);

  return { containerRef, swipeState };
}
