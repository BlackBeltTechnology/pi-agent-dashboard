/**
 * `useNow` relocation keeps the old import path. See change:
 * show-session-history-load-state (test-plan #E7).
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNow as useNowOld } from "../../access-grants/yolo-status.js";
import { useNow } from "../use-now.js";

describe("useNow (#E7)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("old and new import are the same function", () => {
    expect(useNowOld).toBe(useNow);
  });

  it("active: value advances by 1000 ms per tick", () => {
    const { result } = renderHook(() => useNow(true));
    const t0 = result.current;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(t0 + 1000);
  });

  it("inactive: no interval armed", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    const { result } = renderHook(() => useNow(false));
    const t0 = result.current;
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(spy).not.toHaveBeenCalled();
    expect(result.current).toBe(t0);
    spy.mockRestore();
  });
});
