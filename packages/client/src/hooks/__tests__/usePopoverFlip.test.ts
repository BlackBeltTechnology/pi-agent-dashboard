import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";
import { usePopoverFlip } from "../usePopoverFlip.js";

/**
 * Build a fake trigger ref whose `getBoundingClientRect` returns a rect placing
 * the trigger's top/bottom at the supplied viewport coordinates.
 */
function makeRef(top: number, bottom: number) {
  const el = {
    getBoundingClientRect: vi.fn(
      () => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top }) as DOMRect,
    ),
  } as unknown as HTMLElement;
  return { current: el } as React.RefObject<HTMLElement>;
}

/** Trigger ref with horizontal coordinates (left/right) for anchor tests. */
function makeRefH(left: number, right: number) {
  const el = {
    getBoundingClientRect: vi.fn(
      () => ({ top: 100, bottom: 130, left, right, width: right - left, height: 30 }) as DOMRect,
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

  it("stays right-anchored in a wide container where the popover fits", () => {
    setViewportWidth(1200);
    // Trigger mid-viewport, ample room to the left of its right edge.
    const ref = makeRefH(500, 600);
    const { result } = renderHook(() =>
      usePopoverFlip(ref, { open: true, estimatedWidth: 256 }),
    );
    expect(result.current.anchorRight).toBe(true);
    // spaceRightAnchor = rect.right - gap = 600 - 8 = 592
    expect(result.current.maxWidth).toBe(592);
  });

  it("flips to left-anchor in a slim container with the trigger near the left edge", () => {
    setViewportWidth(300);
    // Trigger hugs the left edge → right-anchor would clip off-screen left.
    const ref = makeRefH(20, 80);
    const { result } = renderHook(() =>
      usePopoverFlip(ref, { open: true, estimatedWidth: 256 }),
    );
    // spaceRightAnchor = 80 - 8 = 72 < 256; spaceLeftAnchor = 300 - 20 - 8 = 272 > 72 → flip
    expect(result.current.anchorRight).toBe(false);
    expect(result.current.maxWidth).toBe(272);
  });

  it("clamps maxWidth to the larger side when neither side fits the full width", () => {
    setViewportWidth(400);
    const ref = makeRefH(150, 200);
    const { result } = renderHook(() =>
      usePopoverFlip(ref, { open: true, estimatedWidth: 256 }),
    );
    // spaceRightAnchor = 200 - 8 = 192; spaceLeftAnchor = 400 - 150 - 8 = 242.
    // Both < 256 (natural width); left side larger → flip + clamp to 242.
    expect(result.current.anchorRight).toBe(false);
    expect(result.current.maxWidth).toBe(242);
  });

  it("preserves the right-anchor by default (unknown estimatedWidth) even near the left edge", () => {
    setViewportWidth(1200);
    const ref = makeRefH(10, 40); // near the left edge
    const { result } = renderHook(() => usePopoverFlip(ref, { open: true }));
    // estimatedWidth defaults to Infinity → never flips → backward-compatible.
    expect(result.current.anchorRight).toBe(true);
    // spaceRightAnchor = 40 - 8 = 32 → clamped up to the 160px floor.
    expect(result.current.maxWidth).toBe(160);
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
});

// Keep the `useRef` import meaningful for type-check parity with real call sites.
void useRef;
