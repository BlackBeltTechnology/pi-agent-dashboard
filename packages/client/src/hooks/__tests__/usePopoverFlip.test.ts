import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";
import { usePopoverFlip } from "../usePopoverFlip.js";

/**
 * Build a fake trigger ref whose `getBoundingClientRect` returns a rect placing
 * the trigger's top/bottom at the supplied viewport coordinates.
 */
function makeRef(top: number, bottom: number, left = 0, right = 0) {
  const el = {
    getBoundingClientRect: vi.fn(
      () =>
        ({
          top,
          bottom,
          left,
          right,
          width: right - left,
          height: bottom - top,
        }) as DOMRect,
    ),
  } as unknown as HTMLElement;
  return { current: el } as React.RefObject<HTMLElement>;
}

function setViewportHeight(h: number) {
  Object.defineProperty(window, "innerHeight", { value: h, configurable: true, writable: true });
}
function setViewportWidth(w: number) {
  Object.defineProperty(window, "innerWidth", { value: w, configurable: true, writable: true });
}

describe("usePopoverFlip", () => {
  beforeEach(() => {
    setViewportHeight(1000);
    setViewportWidth(1200);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens downward by default when there is ample space below", () => {
    const ref = makeRef(100, 130); // trigger near top of a 1000px viewport
    const { result } = renderHook(() => usePopoverFlip(ref, { open: true }));
    expect(result.current.flipUp).toBe(false);
    // spaceBelow = 1000 - 130 - 8 = 862
    expect(result.current.maxHeight).toBe(862);
  });

  it("flips up when below-space is short and above-space is larger", () => {
    const ref = makeRef(900, 930); // trigger near the bottom edge
    const { result } = renderHook(() => usePopoverFlip(ref, { open: true }));
    expect(result.current.flipUp).toBe(true);
    // spaceAbove = 900 - 8 = 892
    expect(result.current.maxHeight).toBe(892);
  });

  it("clamps maxHeight with a 120px floor", () => {
    // Tiny viewport so the chosen-direction space is below the floor.
    setViewportHeight(150);
    const ref = makeRef(60, 90);
    const { result } = renderHook(() => usePopoverFlip(ref, { open: true }));
    expect(result.current.maxHeight).toBe(120);
  });

  it("re-evaluates on resize while open", () => {
    const ref = makeRef(100, 130);
    const { result } = renderHook(() => usePopoverFlip(ref, { open: true }));
    expect(result.current.flipUp).toBe(false);

    // Move the trigger near the bottom, shrink viewport, fire resize.
    ref.current!.getBoundingClientRect = vi.fn(
      () => ({ top: 900, bottom: 930, left: 0, right: 0, width: 0, height: 30 }) as DOMRect,
    );
    setViewportHeight(950);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current.flipUp).toBe(true);
  });

  it("re-evaluates on scroll while open", () => {
    const ref = makeRef(100, 130);
    const { result } = renderHook(() => usePopoverFlip(ref, { open: true }));
    expect(result.current.flipUp).toBe(false);

    ref.current!.getBoundingClientRect = vi.fn(
      () => ({ top: 940, bottom: 970, left: 0, right: 0, width: 0, height: 30 }) as DOMRect,
    );
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.flipUp).toBe(true);
  });

  it("attaches no listeners and does not measure when open=false", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const ref = makeRef(900, 930);
    const { result } = renderHook(() => usePopoverFlip(ref, { open: false }));
    expect(result.current.flipUp).toBe(false);
    expect(ref.current!.getBoundingClientRect).not.toHaveBeenCalled();
    expect(addSpy).not.toHaveBeenCalledWith("resize", expect.anything(), expect.anything());
    expect(addSpy).not.toHaveBeenCalledWith("scroll", expect.anything(), expect.anything());
  });

  it("aligns right by default when the popover fits left of the trigger right edge", () => {
    // Trigger near the right side of a wide viewport — classic desktop case.
    const ref = makeRef(100, 130, 900, 980);
    const { result } = renderHook(() =>
      usePopoverFlip(ref, { open: true, estimatedWidth: 256 }),
    );
    expect(result.current.alignRight).toBe(true);
  });

  it("aligns left when right-align would hang past the left viewport edge", () => {
    // Mobile StatusBar leading: View button near left edge (repro of the iOS clip).
    setViewportWidth(390);
    const ref = makeRef(719, 743, 41, 101);
    const { result } = renderHook(() =>
      usePopoverFlip(ref, { open: true, estimatedWidth: 256 }),
    );
    expect(result.current.alignRight).toBe(false);
  });
});

// Keep the `useRef` import meaningful for type-check parity with real call sites.
void useRef;
