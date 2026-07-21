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

/** Full-rect trigger ref for boundary-aware cases (all four edges settable). */
function makeTrigger(rect: Partial<DOMRect>) {
  const full = {
    top: 100,
    bottom: 130,
    left: 0,
    right: 0,
    width: 0,
    height: 30,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect;
  const el = {
    getBoundingClientRect: vi.fn(() => full),
  } as unknown as HTMLElement;
  return { current: el } as React.RefObject<HTMLElement>;
}

interface MockBoundary {
  ref: React.RefObject<HTMLElement>;
  el: HTMLElement & { __fire: (type: string) => void };
  setRect: (rect: Partial<DOMRect>) => void;
  addSpy: ReturnType<typeof vi.fn>;
}

/**
 * Mock clipping boundary: settable rect, captured event listeners (fire them
 * via `__fire`), and a `contains` that reports whether it holds the trigger
 * (default true → no self-boundary warning).
 */
function makeBoundary(rect: Partial<DOMRect>, opts?: { containsTrigger?: boolean }): MockBoundary {
  const containsTrigger = opts?.containsTrigger ?? true;
  const listeners: Record<string, EventListener[]> = {};
  let current: DOMRect = {
    top: 0,
    bottom: 1000,
    left: 0,
    right: 1000,
    width: 1000,
    height: 1000,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect;
  const addSpy = vi.fn((type: string, cb: EventListener) => {
    (listeners[type] ??= []).push(cb);
  });
  const el = {
    getBoundingClientRect: vi.fn(() => current),
    contains: vi.fn(() => containsTrigger),
    addEventListener: addSpy,
    removeEventListener: vi.fn((type: string, cb: EventListener) => {
      listeners[type] = (listeners[type] ?? []).filter((f) => f !== cb);
    }),
    __fire: (type: string) => {
      for (const cb of listeners[type] ?? []) cb(new Event(type));
    },
  } as unknown as HTMLElement & { __fire: (type: string) => void };
  return {
    ref: { current: el } as React.RefObject<HTMLElement>,
    el,
    setRect: (r: Partial<DOMRect>) => {
      current = { ...current, ...r } as DOMRect;
    },
    addSpy,
  };
}

// Mocked ResizeObserver capturing the last-constructed callback.
let roCallbacks: ResizeObserverCallback[] = [];
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(cb: ResizeObserverCallback) {
    roCallbacks.push(cb);
  }
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

  describe("boundary-aware measurement", () => {
    let originalRO: typeof ResizeObserver | undefined;
    beforeEach(() => {
      setViewportWidth(1280);
      roCallbacks = [];
      originalRO = globalThis.ResizeObserver;
      globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    });
    afterEach(() => {
      globalThis.ResizeObserver = originalRO as typeof ResizeObserver;
    });

    it("E1 measures the horizontal axis against the boundary rect", () => {
      const b = makeBoundary({ left: 360, right: 660 });
      const trigger = makeTrigger({ left: 399, right: 461 });
      const { result } = renderHook(() =>
        usePopoverFlip(trigger, { open: true, estimatedWidth: 256, boundaryRef: b.ref }),
      );
      // spaceRightAnchor = 461 - 8 - 360 = 93 (<256); spaceLeftAnchor = 660 - 399 - 8 = 253
      expect(result.current.anchorRight).toBe(false);
      expect(result.current.maxWidth).toBe(253);
      expect(result.current.maxWidth).toBeLessThanOrEqual(300); // boundary width
    });

    it("E2 honors the boundary over the viewport — the core bug", () => {
      const trigger = makeTrigger({ left: 399, right: 461 });
      const withBoundary = makeBoundary({ left: 360, right: 780 });
      const withB = renderHook(() =>
        usePopoverFlip(trigger, { open: true, estimatedWidth: 256, boundaryRef: withBoundary.ref }),
      );
      const withoutB = renderHook(() =>
        usePopoverFlip(trigger, { open: true, estimatedWidth: 256 }),
      );
      // Without boundary: spaceRightAnchor = 461 - 8 = 453 ≥ 256 → keeps right.
      expect(withoutB.result.current.anchorRight).toBe(true);
      // With boundary: spaceRightAnchor = 93 < 256, spaceLeftAnchor = 373 → flips.
      expect(withB.result.current.anchorRight).toBe(false);
      expect(withB.result.current.anchorRight).not.toBe(withoutB.result.current.anchorRight);
    });

    it("E3 viewport fallback is byte-identical when no boundary is supplied", () => {
      setViewportHeight(1000);
      setViewportWidth(1200);
      const trigger = makeTrigger({ top: 100, bottom: 130, left: 500, right: 600 });
      const { result } = renderHook(() =>
        usePopoverFlip(trigger, { open: true, estimatedWidth: 256 }),
      );
      expect(result.current.flipUp).toBe(false);
      expect(result.current.maxHeight).toBe(862); // 1000 - 130 - 8
      expect(result.current.anchorRight).toBe(true);
      expect(result.current.maxWidth).toBe(592); // 600 - 8
    });

    it("E4 measures the vertical axis against the boundary rect", () => {
      setViewportHeight(1000);
      const trigger = makeTrigger({ top: 356, bottom: 380 });
      const vb = makeBoundary({ top: 100, bottom: 400 });
      const withB = renderHook(() =>
        usePopoverFlip(trigger, {
          open: true,
          estimatedHeight: 200,
          boundaryRef: vb.ref,
        }),
      );
      const withoutB = renderHook(() =>
        usePopoverFlip(trigger, { open: true, estimatedHeight: 200 }),
      );
      // With boundary: spaceBelow = 400 - 380 - 8 = 12 < 200 → flip up.
      expect(withB.result.current.flipUp).toBe(true);
      // Without boundary: spaceBelow = 1000 - 380 - 8 = 612 → no flip.
      expect(withoutB.result.current.flipUp).toBe(false);
    });

    it("E5 preferredAnchor left is preserved when it fits", () => {
      const b = makeBoundary({ left: 0, right: 1000 });
      const trigger = makeTrigger({ left: 100, right: 160 });
      const { result } = renderHook(() =>
        usePopoverFlip(trigger, {
          open: true,
          estimatedWidth: 256,
          preferredAnchor: "left",
          boundaryRef: b.ref,
        }),
      );
      // spaceLeftAnchor = 1000 - 100 - 8 = 892 ≥ 256 → stays left.
      expect(result.current.anchorRight).toBe(false);
    });

    it("E6 preferredAnchor left flips only when forced", () => {
      const b = makeBoundary({ left: 0, right: 300 });
      const trigger = makeTrigger({ left: 250, right: 280 });
      const { result } = renderHook(() =>
        usePopoverFlip(trigger, {
          open: true,
          estimatedWidth: 256,
          preferredAnchor: "left",
          boundaryRef: b.ref,
        }),
      );
      // spaceLeftAnchor = 300 - 250 - 8 = 42 < 256; spaceRightAnchor = 280 - 8 = 272 → flip.
      expect(result.current.anchorRight).toBe(true);
    });

    it("E7 minContentWidth flips instead of squishing", () => {
      const b = makeBoundary({ left: 0, right: 678 });
      const trigger = makeTrigger({ left: 400, right: 408 });
      const { result } = renderHook(() =>
        usePopoverFlip(trigger, {
          open: true,
          preferredAnchor: "left",
          minContentWidth: 280,
          boundaryRef: b.ref,
        }),
      );
      // spaceLeftAnchor = 678 - 400 - 8 = 270 < 280; spaceRightAnchor = 408 - 8 = 400 → flip.
      expect(result.current.anchorRight).toBe(true);
      expect(result.current.maxWidth).toBe(400); // NOT clamped to 270
    });

    it("E8 minContentWidth clamps only when neither side fits", () => {
      const b = makeBoundary({ left: 0, right: 388 });
      const trigger = makeTrigger({ left: 180, right: 188 });
      const { result } = renderHook(() =>
        usePopoverFlip(trigger, {
          open: true,
          minContentWidth: 280,
          boundaryRef: b.ref,
        }),
      );
      // spaceRightAnchor = 188 - 8 = 180; spaceLeftAnchor = 388 - 180 - 8 = 200. Neither ≥ 280.
      // Larger side is left (200) → picks it, clamps maxWidth = max(160, 200) = 200.
      expect(result.current.anchorRight).toBe(false);
      expect(result.current.maxWidth).toBe(200);
    });

    it("F1 re-measures on boundary scroll", () => {
      const b = makeBoundary({ left: 0, right: 1000 });
      const trigger = makeTrigger({ left: 100, right: 160 });
      const { result } = renderHook(() =>
        usePopoverFlip(trigger, {
          open: true,
          estimatedWidth: 256,
          preferredAnchor: "left",
          boundaryRef: b.ref,
        }),
      );
      expect(result.current.maxWidth).toBe(892); // 1000 - 100 - 8
      act(() => {
        b.setRect({ right: 300 });
        b.el.__fire("scroll");
      });
      // spaceLeftAnchor = 300 - 100 - 8 = 192 → re-measured.
      expect(result.current.maxWidth).toBe(192);
    });

    it("F2 re-measures on boundary resize (ResizeObserver)", () => {
      const b = makeBoundary({ left: 0, right: 1000 });
      const trigger = makeTrigger({ left: 100, right: 160 });
      const { result } = renderHook(() =>
        usePopoverFlip(trigger, {
          open: true,
          estimatedWidth: 256,
          preferredAnchor: "left",
          boundaryRef: b.ref,
        }),
      );
      expect(result.current.maxWidth).toBe(892);
      expect(roCallbacks.length).toBeGreaterThan(0);
      act(() => {
        b.setRect({ right: 300 });
        for (const cb of roCallbacks) cb([], {} as ResizeObserver);
      });
      expect(result.current.maxWidth).toBe(192);
    });

    it("F3 attaches no boundary listeners while closed", () => {
      const b = makeBoundary({ left: 0, right: 1000 });
      const trigger = makeTrigger({ left: 100, right: 160 });
      renderHook(() =>
        usePopoverFlip(trigger, { open: false, boundaryRef: b.ref }),
      );
      expect(trigger.current!.getBoundingClientRect).not.toHaveBeenCalled();
      expect(b.addSpy).not.toHaveBeenCalled();
      expect(roCallbacks.length).toBe(0);
    });

    it("X1 falls back to the viewport when the boundary ref is null", () => {
      setViewportWidth(1200);
      const nullBoundary = { current: null } as React.RefObject<HTMLElement | null>;
      const trigger = makeTrigger({ left: 500, right: 600 });
      const { result } = renderHook(() =>
        usePopoverFlip(trigger, { open: true, boundaryRef: nullBoundary }),
      );
      expect(Number.isFinite(result.current.maxWidth)).toBe(true);
      expect(Number.isFinite(result.current.maxHeight)).toBe(true);
      expect(result.current.anchorRight).toBe(true);
      expect(result.current.maxWidth).toBe(592); // viewport fallback: 600 - 8
    });

    it("X2 warns (dev) when the boundary does not contain the trigger", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const b = makeBoundary({ left: 0, right: 1000 }, { containsTrigger: false });
      const trigger = makeTrigger({ left: 100, right: 160 });
      expect(() =>
        renderHook(() => usePopoverFlip(trigger, { open: true, boundaryRef: b.ref })),
      ).not.toThrow();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]?.[0])).toMatch(/boundary/i);
    });
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
