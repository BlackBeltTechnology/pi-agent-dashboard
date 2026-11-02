/**
 * Per-session collapse persistence. See change: fix-flow-ui-graph-zoom-summary.
 * Default collapsed + Open flow… expands: change flows-dock-chip-and-panel-actions
 * (test-plan E25–E27).
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FLOW_SHOW_ERROR_ROUTES_KEY,
  flowCollapseKey,
  setFlowCollapsed,
  useFlowCollapsePersisted,
  usePersistedToggle,
} from "../client/flow-collapse-storage.js";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("useFlowCollapsePersisted", () => {
  it("E25: defaults to collapsed (true) for an untouched session, both kinds", () => {
    expect(renderHook(() => useFlowCollapsePersisted("sess-A", "summary")).result.current[0]).toBe(true);
    expect(renderHook(() => useFlowCollapsePersisted("sess-A", "dashboard")).result.current[0]).toBe(true);
  });

  it("persists the user's expand across remounts for the same session", () => {
    const first = renderHook(() => useFlowCollapsePersisted("sess-A", "summary"));
    act(() => first.result.current[1]()); // toggle → expanded
    expect(first.result.current[0]).toBe(false);
    expect(localStorage.getItem(flowCollapseKey("summary", "sess-A"))).toBe("false");

    // Fresh mount (same session) reads the persisted value.
    const second = renderHook(() => useFlowCollapsePersisted("sess-A", "summary"));
    expect(second.result.current[0]).toBe(false);
  });

  it("E26: a stored expand is kept across a remount (new run) and storage is unchanged", () => {
    localStorage.setItem(flowCollapseKey("dashboard", "sess-A"), "false");
    const { result, unmount } = renderHook(() => useFlowCollapsePersisted("sess-A", "dashboard"));
    expect(result.current[0]).toBe(false);
    unmount();
    expect(renderHook(() => useFlowCollapsePersisted("sess-A", "dashboard")).result.current[0]).toBe(false);
    expect(localStorage.getItem(flowCollapseKey("dashboard", "sess-A"))).toBe("false");
  });

  it("E27: setFlowCollapsed expands a mounted, collapsed panel and persists it", () => {
    const { result } = renderHook(() => useFlowCollapsePersisted("sess-A", "dashboard"));
    expect(result.current[0]).toBe(true);
    act(() => setFlowCollapsed("sess-A", ["dashboard"], false));
    expect(result.current[0]).toBe(false);
    expect(localStorage.getItem(flowCollapseKey("dashboard", "sess-A"))).toBe("false");
  });

  it("isolates state per session id", () => {
    const a = renderHook(() => useFlowCollapsePersisted("sess-A", "summary"));
    act(() => a.result.current[1]()); // A expanded
    const b = renderHook(() => useFlowCollapsePersisted("sess-B", "summary"));
    expect(b.result.current[0]).toBe(true); // B untouched → collapsed
  });

  it("isolates state per kind for the same session", () => {
    const summary = renderHook(() => useFlowCollapsePersisted("sess-A", "summary"));
    act(() => summary.result.current[1]());
    const dashboard = renderHook(() => useFlowCollapsePersisted("sess-A", "dashboard"));
    expect(dashboard.result.current[0]).toBe(true);
  });

  it("degrades to in-memory when localStorage.setItem throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const { result } = renderHook(() => useFlowCollapsePersisted("sess-A", "summary"));
    expect(() => act(() => result.current[1]())).not.toThrow();
    expect(result.current[0]).toBe(false); // toggle still works in-memory
  });

  it("is purely in-memory when sessionId is undefined", () => {
    const setSpy = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(() => useFlowCollapsePersisted(undefined, "summary"));
    act(() => result.current[1]());
    expect(result.current[0]).toBe(false);
    expect(setSpy).not.toHaveBeenCalled();
  });
});

describe("usePersistedToggle (global error-route visibility)", () => {
  it("defaults to the fallback when unset", () => {
    const { result } = renderHook(() => usePersistedToggle(FLOW_SHOW_ERROR_ROUTES_KEY, false));
    expect(result.current[0]).toBe(false);
  });

  it("persists on/off across remounts (global key, no session)", () => {
    const first = renderHook(() => usePersistedToggle(FLOW_SHOW_ERROR_ROUTES_KEY, false));
    act(() => first.result.current[1]()); // on
    expect(first.result.current[0]).toBe(true);
    expect(localStorage.getItem(FLOW_SHOW_ERROR_ROUTES_KEY)).toBe("true");

    const second = renderHook(() => usePersistedToggle(FLOW_SHOW_ERROR_ROUTES_KEY, false));
    expect(second.result.current[0]).toBe(true); // remount reads persisted ON

    act(() => second.result.current[1]()); // off
    expect(localStorage.getItem(FLOW_SHOW_ERROR_ROUTES_KEY)).toBe("false");
    const third = renderHook(() => usePersistedToggle(FLOW_SHOW_ERROR_ROUTES_KEY, false));
    expect(third.result.current[0]).toBe(false);
  });

  it("degrades to in-memory when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    const { result } = renderHook(() => usePersistedToggle(FLOW_SHOW_ERROR_ROUTES_KEY, false));
    expect(() => act(() => result.current[1]())).not.toThrow();
    expect(result.current[0]).toBe(true);
  });
});
