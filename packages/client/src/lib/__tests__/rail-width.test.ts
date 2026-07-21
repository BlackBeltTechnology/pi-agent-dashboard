import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampRailWidth,
  loadRailWidth,
  RAIL_DEFAULT,
  RAIL_KEY_PREFIX,
  RAIL_MAX,
  RAIL_MIN,
  saveRailWidth,
  useRailWidth,
} from "../layout/rail-width.js";
import { loadSplitState, saveSplitState } from "../layout/split-state.js";

describe("clampRailWidth", () => {
  it("passes through in range", () => {
    expect(clampRailWidth(240)).toBe(240);
  });
  it("clamps to bounds", () => {
    expect(clampRailWidth(10)).toBe(RAIL_MIN);
    expect(clampRailWidth(9999)).toBe(RAIL_MAX);
  });
  it("coerces NaN to default", () => {
    expect(clampRailWidth(Number.NaN)).toBe(RAIL_DEFAULT);
  });
});

describe("persistence", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips", () => {
    saveRailWidth("s1", 260);
    expect(loadRailWidth("s1")).toBe(260);
  });

  it("defaults when absent", () => {
    expect(loadRailWidth("absent")).toBe(RAIL_DEFAULT);
  });

  it("defaults on corrupt value", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(`${RAIL_KEY_PREFIX}bad`, "not-a-number");
    expect(loadRailWidth("bad")).toBe(RAIL_DEFAULT);
    spy.mockRestore();
  });
});

describe("rail width is independent of the outer split ratio", () => {
  beforeEach(() => localStorage.clear());

  it("resizing the rail does not change the persisted split ratio", () => {
    saveSplitState("sInd", { mode: "split", ratio: 0.6, orientation: "h" });
    saveRailWidth("sInd", 300);
    expect(loadSplitState("sInd").ratio).toBe(0.6);
    expect(loadRailWidth("sInd")).toBe(300);
  });

  it("changing the split ratio does not change the persisted rail width", () => {
    saveRailWidth("sInd2", 300);
    saveSplitState("sInd2", { mode: "split", ratio: 0.3, orientation: "h" });
    expect(loadRailWidth("sInd2")).toBe(300);
    expect(loadSplitState("sInd2").ratio).toBe(0.3);
  });
});

describe("useRailWidth", () => {
  beforeEach(() => localStorage.clear());

  it("persists and clamps through the setter", () => {
    const { result, unmount } = renderHook(() => useRailWidth("sR"));
    expect(result.current[0]).toBe(RAIL_DEFAULT);
    act(() => result.current[1](9999));
    expect(result.current[0]).toBe(RAIL_MAX);
    unmount();
    const reopened = renderHook(() => useRailWidth("sR"));
    expect(reopened.result.current[0]).toBe(RAIL_MAX);
  });
});
