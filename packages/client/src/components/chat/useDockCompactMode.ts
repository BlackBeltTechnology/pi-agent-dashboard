/**
 * Compact-mode switch of the composer dock.
 *
 * Compact below a 32.5rem composer column (520 px at the default 16 px root).
 * The width comes from a `ResizeObserver` on the composer COLUMN (the `bottom`
 * stack), not on the dock, so the dock's own layout and scrollbars cannot feed
 * back into the measurement. Observer callbacks only record the latest width;
 * the layout mode is evaluated at most once per animation frame (split-divider
 * drags fire many callbacks per frame). The flip is exact at the threshold, no
 * hysteresis. A width of 0 (unmeasured / hidden) never flips the layout.
 *
 * `onBeforeFlip` runs synchronously before the state change so the caller can
 * record where focus was while the old layout is still mounted.
 *
 * See change: add-composer-dock (D2).
 */
import { useEffect, useRef, useState } from "react";

/** 32.5rem: 520 px at the default root font size. */
export const DOCK_COMPACT_REM = 32.5;

function rootFontPx(): number {
  const px = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(px) && px > 0 ? px : 16;
}

function entryWidth(entry: ResizeObserverEntry): number {
  const box = Array.isArray(entry.borderBoxSize) ? entry.borderBoxSize[0] : entry.borderBoxSize;
  return box?.inlineSize ?? entry.contentRect.width;
}

export function useDockCompactMode(columnEl: HTMLElement | null | undefined, onBeforeFlip?: () => void): boolean {
  const [compact, setCompact] = useState(false);
  const compactRef = useRef(false);
  const beforeFlipRef = useRef(onBeforeFlip);
  beforeFlipRef.current = onBeforeFlip;

  useEffect(() => {
    if (!columnEl || typeof ResizeObserver === "undefined") return;
    let width = columnEl.getBoundingClientRect().width;
    let frame = 0;

    const evaluate = () => {
      frame = 0;
      if (width <= 0) return;
      const next = width < DOCK_COMPACT_REM * rootFontPx();
      if (next === compactRef.current) return;
      beforeFlipRef.current?.();
      compactRef.current = next;
      setCompact(next);
    };

    evaluate();
    const observer = new ResizeObserver((entries) => {
      const last = entries[entries.length - 1];
      if (!last) return;
      width = entryWidth(last);
      if (frame === 0) frame = requestAnimationFrame(evaluate);
    });
    observer.observe(columnEl);
    return () => {
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [columnEl]);

  return compact;
}
