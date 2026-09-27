/**
 * Status-lane hysteresis. See change: session-list-group-by (design D3).
 */
import type { StatusLaneId } from "@blackbelt-technology/pi-dashboard-shared/session-group-by.js";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_HYSTERESIS, stepLaneHysteresis, useLaneHysteresis } from "../useLaneHysteresis.js";

const m = (o: Record<string, StatusLaneId>) => new Map(Object.entries(o));

describe("stepLaneHysteresis (pure)", () => {
  it("first sight applies the raw lane", () => {
    const s = stepLaneHysteresis(EMPTY_HYSTERESIS, m({ a: "idle" }), 0);
    expect(s.displayed.get("a")).toBe("idle");
    expect(s.holds.size).toBe(0);
  });

  it("working → review is held, then applies after the hold", () => {
    const s0 = stepLaneHysteresis(EMPTY_HYSTERESIS, m({ a: "working" }), 0);
    const s1 = stepLaneHysteresis(s0, m({ a: "review" }), 100);
    expect(s1.displayed.get("a")).toBe("working");
    expect(s1.holds.get("a")).toEqual({ until: 3100, dest: "review" });
    const s2 = stepLaneHysteresis(s1, m({ a: "review" }), 3100);
    expect(s2.displayed.get("a")).toBe("review");
    expect(s2.holds.size).toBe(0);
  });

  it("re-entering working within the hold never moves", () => {
    const s0 = stepLaneHysteresis(EMPTY_HYSTERESIS, m({ a: "working" }), 0);
    const s1 = stepLaneHysteresis(s0, m({ a: "idle" }), 10);
    const s2 = stepLaneHysteresis(s1, m({ a: "working" }), 500);
    expect(s2.displayed.get("a")).toBe("working");
    expect(s2.holds.size).toBe(0);
  });

  it("dest follows the raw lane while held, hold deadline is kept", () => {
    const s0 = stepLaneHysteresis(EMPTY_HYSTERESIS, m({ a: "working" }), 0);
    const s1 = stepLaneHysteresis(s0, m({ a: "idle" }), 0);
    const s2 = stepLaneHysteresis(s1, m({ a: "review" }), 1000);
    expect(s2.holds.get("a")).toEqual({ until: 3000, dest: "review" });
  });

  it("needs-you and error apply immediately", () => {
    const s0 = stepLaneHysteresis(EMPTY_HYSTERESIS, m({ a: "working", b: "working" }), 0);
    const s1 = stepLaneHysteresis(s0, m({ a: "needs-you", b: "error" }), 1);
    expect(s1.displayed.get("a")).toBe("needs-you");
    expect(s1.displayed.get("b")).toBe("error");
    expect(s1.holds.size).toBe(0);
  });

  it("review → idle is not held", () => {
    const s0 = stepLaneHysteresis(EMPTY_HYSTERESIS, m({ a: "review" }), 0);
    expect(stepLaneHysteresis(s0, m({ a: "idle" }), 1).displayed.get("a")).toBe("idle");
  });

  it("drops sessions no longer present", () => {
    const s0 = stepLaneHysteresis(EMPTY_HYSTERESIS, m({ a: "working" }), 0);
    const s1 = stepLaneHysteresis(s0, m({ a: "idle" }), 0);
    const s2 = stepLaneHysteresis(s1, m({}), 1);
    expect(s2.displayed.size).toBe(0);
    expect(s2.holds.size).toBe(0);
  });
});

describe("useLaneHysteresis (fake timers)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("moves the card after the hold without further input", () => {
    const { result, rerender } = renderHook(({ raw }) => useLaneHysteresis(raw, 3000), {
      initialProps: { raw: m({ a: "working" }) },
    });
    rerender({ raw: m({ a: "review" }) });
    expect(result.current.displayed.get("a")).toBe("working");
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(result.current.displayed.get("a")).toBe("review");
  });

  it("re-enters working within the hold ⇒ no move, timer cleared on unmount", () => {
    const { result, rerender, unmount } = renderHook(({ raw }) => useLaneHysteresis(raw, 3000), {
      initialProps: { raw: m({ a: "working" }) },
    });
    rerender({ raw: m({ a: "idle" }) });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    rerender({ raw: m({ a: "working" }) });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.displayed.get("a")).toBe("working");
    rerender({ raw: m({ a: "idle" }) });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
