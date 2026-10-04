import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useZoomPan } from "../useZoomPan.js";

describe("useZoomPan", () => {
  it("starts at scale 1 with zero translate", () => {
    const { result } = renderHook(() => useZoomPan());
    expect(result.current.state).toEqual({ scale: 1, translateX: 0, translateY: 0 });
  });

  it("zoomIn increases scale by step", () => {
    const { result } = renderHook(() => useZoomPan({ zoomStep: 1.2 }));
    act(() => result.current.zoomIn());
    expect(result.current.state.scale).toBeCloseTo(1.2);
  });

  it("zoomOut decreases scale by step", () => {
    const { result } = renderHook(() => useZoomPan({ zoomStep: 1.2 }));
    act(() => result.current.zoomOut());
    expect(result.current.state.scale).toBeCloseTo(1 / 1.2);
  });

  it("clamps scale at maxScale", () => {
    const { result } = renderHook(() => useZoomPan({ maxScale: 2, zoomStep: 2 }));
    act(() => result.current.zoomIn()); // 2
    act(() => result.current.zoomIn()); // clamped to 2
    expect(result.current.state.scale).toBe(2);
  });

  it("clamps scale at minScale", () => {
    const { result } = renderHook(() => useZoomPan({ minScale: 0.5, zoomStep: 2 }));
    act(() => result.current.zoomOut()); // 0.5
    act(() => result.current.zoomOut()); // clamped to 0.5
    expect(result.current.state.scale).toBe(0.5);
  });

  it("reset restores initial state", () => {
    const { result } = renderHook(() => useZoomPan());
    act(() => result.current.zoomIn());
    act(() => result.current.zoomIn());
    expect(result.current.state.scale).not.toBe(1);
    act(() => result.current.reset());
    expect(result.current.state).toEqual({ scale: 1, translateX: 0, translateY: 0 });
  });

  it("double-click resets state", () => {
    const { result } = renderHook(() => useZoomPan());
    act(() => result.current.zoomIn());
    act(() => result.current.handlers.onDoubleClick());
    expect(result.current.state).toEqual({ scale: 1, translateX: 0, translateY: 0 });
  });

  it("exposes all expected handler keys", () => {
    const { result } = renderHook(() => useZoomPan());
    const keys = Object.keys(result.current.handlers);
    expect(keys).toContain("onWheel");
    expect(keys).toContain("onPointerDown");
    expect(keys).toContain("onPointerMove");
    expect(keys).toContain("onPointerUp");
    expect(keys).toContain("onTouchMove");
    expect(keys).toContain("onTouchEnd");
    expect(keys).toContain("onDoubleClick");
  });
});

describe("useZoomPan click-vs-drag threshold", () => {
  function makeTarget() {
    let captures = 0;
    const target = {
      setPointerCapture: () => { captures += 1; },
      releasePointerCapture: () => {},
    };
    return { target, captureCount: () => captures };
  }

  // A press+release with no movement must remain a click: no capture (which would
  // steal the click from a child onClick), no translate.
  it("tap with no movement: no capture, no translate", () => {
    const { result } = renderHook(() => useZoomPan());
    const { target, captureCount } = makeTarget();
    act(() => {
      result.current.handlers.onPointerDown({ button: 0, clientX: 50, clientY: 50, pointerId: 1, currentTarget: target } as never);
      result.current.handlers.onPointerUp();
    });
    expect(captureCount()).toBe(0);
    expect(result.current.state).toEqual({ scale: 1, translateX: 0, translateY: 0 });
  });

  it("movement at or below threshold (3px): no capture, no translate", () => {
    const { result } = renderHook(() => useZoomPan());
    const { target, captureCount } = makeTarget();
    act(() => {
      result.current.handlers.onPointerDown({ button: 0, clientX: 50, clientY: 50, pointerId: 1, currentTarget: target } as never);
      result.current.handlers.onPointerMove({ clientX: 53, clientY: 50, pointerId: 1, currentTarget: target } as never);
    });
    expect(captureCount()).toBe(0);
    expect(result.current.state.translateX).toBe(0);
    expect(result.current.state.translateY).toBe(0);
  });

  it("movement beyond threshold: captures once and translates", () => {
    const { result } = renderHook(() => useZoomPan());
    const { target, captureCount } = makeTarget();
    act(() => {
      result.current.handlers.onPointerDown({ button: 0, clientX: 50, clientY: 50, pointerId: 1, currentTarget: target } as never);
      result.current.handlers.onPointerMove({ clientX: 60, clientY: 50, pointerId: 1, currentTarget: target } as never);
    });
    expect(captureCount()).toBe(1);
    expect(result.current.state.translateX).toBe(10);
    // A further move keeps dragging without re-capturing.
    act(() => {
      result.current.handlers.onPointerMove({ clientX: 65, clientY: 50, pointerId: 1, currentTarget: target } as never);
    });
    expect(captureCount()).toBe(1);
    expect(result.current.state.translateX).toBe(15);
  });

  it("non-primary button does not start a pending drag", () => {
    const { result } = renderHook(() => useZoomPan());
    const { target, captureCount } = makeTarget();
    act(() => {
      result.current.handlers.onPointerDown({ button: 2, clientX: 50, clientY: 50, pointerId: 1, currentTarget: target } as never);
      result.current.handlers.onPointerMove({ clientX: 80, clientY: 50, pointerId: 1, currentTarget: target } as never);
    });
    expect(captureCount()).toBe(0);
    expect(result.current.state.translateX).toBe(0);
  });
});

// See change: fix-markdown-remount-storm (D4) — optional initialScale.
describe("useZoomPan initialScale", () => {
  const zero = { translateX: 0, translateY: 0 };
  const init = (o?: Parameters<typeof useZoomPan>[0]) => renderHook(() => useZoomPan(o)).result;

  it.each([
    ["in default band", { initialScale: 2.5 }, 2.5],
    ["min boundary", { initialScale: 0.5 }, 0.5],
    ["below min clamps", { initialScale: 0.4 }, 0.5],
    ["max boundary", { initialScale: 4 }, 4],
    ["above max clamps", { initialScale: 4.5 }, 4],
    ["custom band honoured", { initialScale: 0.4, minScale: 0.25, maxScale: 10 }, 0.4],
  ])("seeds scale: %s", (_n, opts, expected) => {
    expect(init(opts).current.state).toEqual({ scale: expected, ...zero });
  });

  it("clamped seed does not widen the bounds", () => {
    const r = init({ initialScale: 0.4 });
    act(() => r.current.zoomOut());
    expect(r.current.state.scale).toBe(0.5);
    const r2 = init({ initialScale: 4.5 });
    act(() => r2.current.zoomIn());
    expect(r2.current.state.scale).toBe(4);
  });

  it("reset and double-click return to initialScale", () => {
    const r = init({ initialScale: 2.5 });
    act(() => { r.current.zoomIn(); r.current.zoomIn(); });
    act(() => r.current.reset());
    expect(r.current.state).toEqual({ scale: 2.5, ...zero });
    act(() => r.current.zoomIn());
    act(() => r.current.handlers.onDoubleClick());
    expect(r.current.state).toEqual({ scale: 2.5, ...zero });
  });

  it("omitted option keeps legacy reset-to-1", () => {
    const r = init();
    act(() => { r.current.zoomIn(); r.current.zoomIn(); });
    act(() => r.current.reset());
    expect(r.current.state).toEqual({ scale: 1, ...zero });
  });

  it("follows a changing initialScale until the user interacts", () => {
    const { result, rerender } = renderHook(({ s }) => useZoomPan({ initialScale: s }), { initialProps: { s: 1 } });
    rerender({ s: 0.7 });
    expect(result.current.state.scale).toBe(0.7);
    act(() => result.current.zoomIn());
    const zoomed = result.current.state.scale;
    rerender({ s: 0.6 });
    expect(result.current.state.scale).toBe(zoomed);
    act(() => result.current.reset());
    expect(result.current.state.scale).toBe(0.6);
  });
});
