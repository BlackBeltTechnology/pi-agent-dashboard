/**
 * Popover — floating panel anchored to a DOM element.
 *
 * The companion of `DialogPortal` for non-modal floating UI. Plugins render
 * `<Popover anchorEl={btnRef.current} onDismiss={...}>...</Popover>` inline
 * from their own component; the popover positions itself relative to
 * `anchorEl`'s viewport rect, lives in a `LayerPortal` (body, or the
 * enclosing dialog's layer host) so it escapes parent overflow/transform
 * contexts, paints at `var(--z-popover)`, and dismisses on outside click or
 * Esc.
 *
 * NOT a modal. NOT a scroll-lock. NOT a tooltip. Strictly a click-anchored
 * floating panel.
 *
 * Registered as the `"ui:popover"` UI primitive via
 * `registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.popover, Popover)` in
 * `packages/client/src/main.tsx`. Plugins look it up with
 * `useUiPrimitive(UI_PRIMITIVE_KEYS.popover)` and avoid importing this file
 * directly.
 *
 * Positioning strategy:
 *   - Default placement is "below the anchor, left-aligned to its left edge".
 *   - If the popover would overflow the viewport bottom, it flips above.
 *   - If it would overflow the right, it shifts left to stay in-viewport.
 *   - Recomputed on window resize/scroll.
 *
 * See change: add-ui-popover-primitive.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { LayerPortal } from "./LayerPortal.js";

export interface PopoverProps {
  /** DOM element the popover is anchored to. Required. */
  anchorEl: HTMLElement;
  /** Called when the user clicks outside or presses Esc. */
  onDismiss: () => void;
  /** Popover content. */
  children: ReactNode;
  /** Optional gap (px) between the anchor and the popover edge. Default 6. */
  offset?: number;
}

interface Position {
  top: number;
  left: number;
  placement: "below" | "above";
}

/**
 * Compute the popover's viewport position given the anchor and the popover's
 * own measured size. Pure helper to ease unit testing.
 */
export function computePopoverPosition(
  anchorRect: DOMRect,
  popoverSize: { width: number; height: number },
  viewport: { width: number; height: number },
  offset: number,
): Position {
  // Default: below anchor, left-aligned to anchor's left edge.
  let top = anchorRect.bottom + offset;
  let left = anchorRect.left;
  let placement: "below" | "above" = "below";

  // Flip above if it would overflow the bottom.
  if (top + popoverSize.height > viewport.height && anchorRect.top - offset - popoverSize.height >= 0) {
    top = anchorRect.top - offset - popoverSize.height;
    placement = "above";
  }

  // Shift left if it would overflow the right edge.
  if (left + popoverSize.width > viewport.width) {
    left = Math.max(8, viewport.width - popoverSize.width - 8);
  }

  // Don't go off the left edge.
  if (left < 8) left = 8;

  return { top, left, placement };
}

export function Popover({ anchorEl, onDismiss, children, offset = 6 }: PopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position | null>(null);

  // Recompute position on mount + on window resize/scroll. useLayoutEffect
  // avoids a one-frame flash at the wrong coordinates.
  useLayoutEffect(() => {
    function update() {
      if (!popoverRef.current) return;
      const anchorRect = anchorEl.getBoundingClientRect();
      const { offsetWidth, offsetHeight } = popoverRef.current;
      setPosition(
        computePopoverPosition(
          anchorRect,
          { width: offsetWidth, height: offsetHeight },
          { width: window.innerWidth, height: window.innerHeight },
          offset,
        ),
      );
    }
    update();
    window.addEventListener("resize", update);
    // Capture-phase scroll listener catches scrolls in any ancestor.
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorEl, offset]);

  // Outside-click + Esc dismissal. Use mousedown so the dismissal happens
  // before any click handler the outside element might run (matches
  // browser-native dropdown UX).
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (!popoverRef.current) return;
      const target = e.target as Node;
      // Click inside the popover OR on the anchor itself: do nothing.
      if (popoverRef.current.contains(target)) return;
      if (anchorEl.contains(target)) return;
      onDismiss();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchorEl, onDismiss]);

  return (
    <LayerPortal>
      <div
        ref={popoverRef}
        role="dialog"
        data-testid="ui-popover"
        data-placement={position?.placement ?? "below"}
        style={{
          position: "fixed",
          top: position?.top ?? -9999,
          left: position?.left ?? -9999,
          zIndex: "var(--z-popover)",
          // Until the first layout effect runs we render off-screen so the
          // measurement happens without flicker.
          visibility: position ? "visible" : "hidden",
        }}
      >
        {children}
      </div>
    </LayerPortal>
  );
}
