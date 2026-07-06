/**
 * useLoopbackLinkOpen — plain loopback click routes to the split viewer;
 * modifier/middle-click, non-loopback, and no-context all no-op.
 * See change: open-loopback-links-in-split-viewer.
 */
import { renderHook } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLoopbackLinkOpen } from "../use-loopback-link-open.js";

const openLiveTarget = vi.fn();
let mockCtx: { openLiveTarget: typeof openLiveTarget } | null = { openLiveTarget };

vi.mock("../../components/SplitWorkspaceContext.js", () => ({
  useOptionalSplitWorkspace: () => mockCtx,
}));

function evt(over: Partial<React.MouseEvent> = {}): React.MouseEvent {
  return {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    ...over,
  } as unknown as React.MouseEvent;
}

afterEach(() => {
  openLiveTarget.mockClear();
  mockCtx = { openLiveTarget };
});

describe("useLoopbackLinkOpen", () => {
  it("plain loopback click prevents default and opens the target in the split", () => {
    const { result } = renderHook(() => useLoopbackLinkOpen());
    const e = evt();
    result.current(e, "http://localhost:50452/report.html");
    expect(e.preventDefault).toHaveBeenCalled();
    expect(openLiveTarget).toHaveBeenCalledWith("http://localhost:50452/report.html");
  });

  it("modifier and middle-click no-op (native anchor handles them)", () => {
    const { result } = renderHook(() => useLoopbackLinkOpen());
    for (const over of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      const e = evt(over);
      result.current(e, "http://localhost:50452/x");
      expect(e.preventDefault).not.toHaveBeenCalled();
    }
    expect(openLiveTarget).not.toHaveBeenCalled();
  });

  it("non-loopback href no-ops", () => {
    const { result } = renderHook(() => useLoopbackLinkOpen());
    const e = evt();
    result.current(e, "http://evil.com/");
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(openLiveTarget).not.toHaveBeenCalled();
  });

  it("null context no-ops without throwing", () => {
    mockCtx = null;
    const { result } = renderHook(() => useLoopbackLinkOpen());
    const e = evt();
    expect(() => result.current(e, "http://localhost:50452/x")).not.toThrow();
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(openLiveTarget).not.toHaveBeenCalled();
  });
});
