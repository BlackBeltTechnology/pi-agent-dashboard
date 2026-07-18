import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampRatio,
  DEFAULT_SPLIT_STATE,
  loadSplitState,
  RATIO_MAX,
  RATIO_MIN,
  SPLIT_KEY_PREFIX,
  type SplitState,
  saveSplitState,
  useSplitState,
} from "../layout/split-state.js";

describe("clampRatio", () => {
  it("passes through values in range", () => {
    expect(clampRatio(0.5)).toBe(0.5);
    expect(clampRatio(RATIO_MIN)).toBe(RATIO_MIN);
    expect(clampRatio(RATIO_MAX)).toBe(RATIO_MAX);
  });

  it("clamps below the minimum", () => {
    expect(clampRatio(0.1)).toBe(RATIO_MIN);
  });

  it("clamps above the maximum", () => {
    expect(clampRatio(0.99)).toBe(RATIO_MAX);
  });

  it("coerces NaN to the default ratio", () => {
    expect(clampRatio(Number.NaN)).toBe(DEFAULT_SPLIT_STATE.ratio);
  });
});

describe("persistence", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips through localStorage", () => {
    const state: SplitState = { mode: "split", ratio: 0.6, orientation: "h" };
    saveSplitState("sess1", state);
    expect(loadSplitState("sess1")).toEqual(state);
  });

  it("returns default state when nothing is stored", () => {
    expect(loadSplitState("absent")).toEqual(DEFAULT_SPLIT_STATE);
  });

  it("recovers from corrupt JSON without throwing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(`${SPLIT_KEY_PREFIX}bad`, "{not json");
    expect(loadSplitState("bad")).toEqual(DEFAULT_SPLIT_STATE);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("discards structurally-invalid state", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(`${SPLIT_KEY_PREFIX}weird`, JSON.stringify({ mode: "nope", ratio: "big" }));
    expect(loadSplitState("weird")).toEqual(DEFAULT_SPLIT_STATE);
    spy.mockRestore();
  });

  it("clamps an out-of-range persisted ratio on load", () => {
    localStorage.setItem(`${SPLIT_KEY_PREFIX}wide`, JSON.stringify({ mode: "split", ratio: 0.95, orientation: "h" }));
    expect(loadSplitState("wide").ratio).toBe(RATIO_MAX);
  });
});

describe("legacy `open` → `mode` migration", () => {
  beforeEach(() => localStorage.clear());

  it("E1 migrates legacy open:true → mode:split, ratio preserved", () => {
    localStorage.setItem(`${SPLIT_KEY_PREFIX}E1`, JSON.stringify({ open: true, ratio: 0.6, orientation: "h" }));
    expect(loadSplitState("E1")).toEqual({ mode: "split", ratio: 0.6, orientation: "h" });
  });

  it("E2 migrates legacy open:false → mode:closed", () => {
    localStorage.setItem(`${SPLIT_KEY_PREFIX}E2`, JSON.stringify({ open: false, ratio: 0.5, orientation: "h" }));
    expect(loadSplitState("E2").mode).toBe("closed");
  });

  it("E3 both-fields precedence: mode wins over legacy open", () => {
    localStorage.setItem(`${SPLIT_KEY_PREFIX}E3`, JSON.stringify({ open: false, mode: "split", ratio: 0.5, orientation: "h" }));
    expect(loadSplitState("E3").mode).toBe("split");
  });

  it("E4 strip-on-write: first save of a migrated legacy blob drops `open`", () => {
    localStorage.setItem(`${SPLIT_KEY_PREFIX}E4`, JSON.stringify({ open: true, ratio: 0.6, orientation: "h" }));
    const loaded = loadSplitState("E4");
    saveSplitState("E4", loaded);
    const raw = JSON.parse(localStorage.getItem(`${SPLIT_KEY_PREFIX}E4`) as string);
    expect(raw).toHaveProperty("mode", "split");
    expect(raw).not.toHaveProperty("open");
  });

  it("E5 clamps an out-of-clamp legacy ratio on migrate (not rejected)", () => {
    localStorage.setItem(`${SPLIT_KEY_PREFIX}E5`, JSON.stringify({ open: true, ratio: 1.2, orientation: "h" }));
    expect(loadSplitState("E5").ratio).toBe(0.75);
  });

  it("E6 corrupt state → mode:closed default, error logged, no crash", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(`${SPLIT_KEY_PREFIX}E6`, "{not json");
    expect(loadSplitState("E6")).toEqual(DEFAULT_SPLIT_STATE);
    expect(loadSplitState("E6").mode).toBe("closed");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("useSplitState", () => {
  beforeEach(() => localStorage.clear());

  it("persists patched changes and reloads them", () => {
    const { result, unmount } = renderHook(() => useSplitState("sX"));
    expect(result.current[0].mode).toBe("closed");
    act(() => result.current[1]({ mode: "split", ratio: 0.6 }));
    expect(result.current[0]).toMatchObject({ mode: "split", ratio: 0.6 });
    unmount();

    const reopened = renderHook(() => useSplitState("sX"));
    expect(reopened.result.current[0]).toMatchObject({ mode: "split", ratio: 0.6 });
  });

  it("loads distinct state per session id", () => {
    saveSplitState("sA", { mode: "split", ratio: 0.5, orientation: "h" });
    saveSplitState("sB", { mode: "closed", ratio: 0.5, orientation: "h" });
    const { result, rerender } = renderHook(({ id }) => useSplitState(id), {
      initialProps: { id: "sA" },
    });
    expect(result.current[0].mode).toBe("split");
    rerender({ id: "sB" });
    expect(result.current[0].mode).toBe("closed");
  });

  it("clamps ratio through the patch updater", () => {
    const { result } = renderHook(() => useSplitState("sClamp"));
    act(() => result.current[1]({ ratio: 0.99 }));
    expect(result.current[0].ratio).toBe(RATIO_MAX);
  });

  it("isolates split state per session and restores it after reload (F14)", () => {
    // Session A: split 50/50. Session B: closed. Switch A→B→A.
    const { result, rerender } = renderHook(({ id }) => useSplitState(id), {
      initialProps: { id: "A" },
    });
    act(() => result.current[1]({ mode: "split", ratio: 0.5 }));
    rerender({ id: "B" });
    expect(result.current[0].mode).toBe("closed"); // B independent (default closed)
    rerender({ id: "A" });
    expect(result.current[0]).toMatchObject({ mode: "split", ratio: 0.5 });

    // "Reload": fresh hook instances read persisted state from localStorage.
    expect(loadSplitState("A")).toMatchObject({ mode: "split", ratio: 0.5 });
    expect(loadSplitState("B").mode).toBe("closed");
  });
});
