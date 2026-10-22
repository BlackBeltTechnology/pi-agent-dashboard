/**
 * Per-session composer-dock collapsed state (test-plan #E6, #E7, #E8).
 * See change: composer-dock-collapse-and-file-open (tasks 1.1, 1.4).
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOCK_COLLAPSED_KEY_PREFIX, loadDockCollapsed, saveDockCollapsed, useDockCollapsed } from "../util/dock-collapsed.js";

describe("dock-collapsed persistence", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("defaults to expanded", () => {
    expect(loadDockCollapsed("s1")).toBe(false);
  });

  it("round-trips collapsed under the per-session key and expanded removes it", () => {
    saveDockCollapsed("s1", true);
    expect(localStorage.getItem(`${DOCK_COLLAPSED_KEY_PREFIX}s1`)).toBe("collapsed");
    expect(loadDockCollapsed("s1")).toBe(true);
    saveDockCollapsed("s1", false);
    expect(localStorage.getItem(`${DOCK_COLLAPSED_KEY_PREFIX}s1`)).toBeNull();
    expect(loadDockCollapsed("s1")).toBe(false);
  });

  it("isolates sessions", () => {
    saveDockCollapsed("s1", true);
    expect(loadDockCollapsed("s2")).toBe(false);
  });

  it("an empty session id never reads or writes", () => {
    const get = vi.spyOn(Storage.prototype, "getItem");
    const set = vi.spyOn(Storage.prototype, "setItem");
    expect(loadDockCollapsed("")).toBe(false);
    saveDockCollapsed("", true);
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it("E7: a throwing store falls back to expanded without throwing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(loadDockCollapsed("s1")).toBe(false);
    expect(() => saveDockCollapsed("s1", true)).not.toThrow();
  });
});

describe("useDockCollapsed", () => {
  beforeEach(() => localStorage.clear());

  it("E6: a session switch returns the new session's value on its first render", () => {
    saveDockCollapsed("s1", true);
    const seen: Array<[string, boolean]> = [];
    const { result, rerender } = renderHook(
      ({ id }) => {
        const r = useDockCollapsed(id);
        seen.push([id, r[0]]);
        return r;
      },
      { initialProps: { id: "s1" } },
    );
    expect(result.current[0]).toBe(true);
    rerender({ id: "s2" });
    expect(result.current[0]).toBe(false);
    rerender({ id: "s1" });
    expect(result.current[0]).toBe(true);
    // No render ever paired a session with the other session's value.
    expect(seen.filter(([id, c]) => (id === "s1") !== c)).toEqual([]);
  });

  it("set persists and updates", () => {
    const { result } = renderHook(() => useDockCollapsed("s1"));
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(loadDockCollapsed("s1")).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    expect(loadDockCollapsed("s1")).toBe(false);
  });

  it("E8: no session id never writes; persist=false reads but never writes", () => {
    const { result } = renderHook(() => useDockCollapsed(""));
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(false);
    expect(localStorage.length).toBe(0);

    saveDockCollapsed("s1", true);
    const frozen = renderHook(() => useDockCollapsed("s1", false));
    expect(frozen.result.current[0]).toBe(true);
    act(() => frozen.result.current[1](false));
    expect(frozen.result.current[0]).toBe(true);
    expect(loadDockCollapsed("s1")).toBe(true);
  });
});
