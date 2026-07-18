import React, { type ReactNode } from "react";
import { useSwipeBack } from "../../hooks/useSwipeBack.js";

interface Props {
  /** 0 = list, 1 = detail, 2 = preview (same panel as detail) */
  depth: number;
  listPanel: ReactNode;
  detailPanel: ReactNode;
  /** Called when swipe-back completes */
  onBack?: () => void;
}

/**
 * Two-panel mobile shell with slide transitions and swipe-back.
 * Both panels stay mounted; CSS transform slides between them.
 * Depth 2 (preview) swaps content within the detail panel — no extra slide.
 */
export function MobileShell({ depth, listPanel, detailPanel, onBack }: Props) {
  const showDetail = depth >= 1;

  const { containerRef, swipeState } = useSwipeBack({
    enabled: showDetail && !!onBack,
    onBack: () => onBack?.(),
  });

  // During swipe, override the transform with the finger position
  const detailTransform = swipeState.swiping
    ? `translateX(${swipeState.offset}px)`
    : showDetail
      ? "translateX(0)"
      : "translateX(100%)";

  const listTransform = swipeState.swiping
    ? `translateX(${-30 + (swipeState.offset / window.innerWidth) * 30}%)`
    : showDetail
      ? "translateX(-30%)"
      : "translateX(0)";

  const transitionClass = swipeState.swiping ? "" : "transition-transform duration-300 ease-out";

  return (
    <div ref={containerRef} className="relative w-screen h-[100dvh] overflow-hidden bg-[var(--bg-primary)]">
      {/* Panel 0: Session list */}
      <div
        className={`absolute inset-0 ${transitionClass} overflow-y-auto`}
        style={{ transform: listTransform }}
        aria-hidden={showDetail}
      >
        {listPanel}
      </div>

      {/* Panel 1: Session detail (or preview at depth 2) */}
      <div
        className={`absolute inset-0 ${transitionClass} bg-[var(--bg-primary)] flex flex-col`}
        style={{ transform: detailTransform }}
        aria-hidden={!showDetail}
      >
        {detailPanel}

      </div>
    </div>
  );
}
