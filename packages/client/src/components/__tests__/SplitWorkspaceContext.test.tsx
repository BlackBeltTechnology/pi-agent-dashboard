import { act, renderHook } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SplitWorkspaceProvider,
  useOptionalSplitWorkspace,
  useSplitWorkspace,
} from "../SplitWorkspaceContext.js";

function wrapper(sessionId = "s1", cwd = "/proj") {
  return ({ children }: { children: React.ReactNode }) => (
    <SplitWorkspaceProvider sessionId={sessionId} cwd={cwd} orientation="h">
      {children}
    </SplitWorkspaceProvider>
  );
}

describe("SplitWorkspaceProvider / openInSplit", () => {
  beforeEach(() => localStorage.clear());

  it("openInSplit opens the split when closed and opens the file as active tab", () => {
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper: wrapper() });
    expect(result.current.split.mode).toBe("closed");

    act(() => result.current.openInSplit("src/foo.ts"));

    expect(result.current.split.mode).toBe("split");
    expect(result.current.paneState.openFiles.map((f) => f.path)).toEqual(["src/foo.ts"]);
    expect(result.current.paneState.activeIndex).toBe(0);
  });

  it("openInSplit with a line records a pending scroll target", () => {
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper: wrapper() });
    act(() => result.current.openInSplit("src/foo.ts", 42));
    expect(result.current.pendingScroll).toEqual({ path: "src/foo.ts", line: 42 });

    act(() => result.current.consumePendingScroll());
    expect(result.current.pendingScroll).toBeNull();
  });

  it("setMode sets the layout mode and persists it", () => {
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper: wrapper("sMode") });
    act(() => result.current.setMode("split"));
    expect(result.current.split.mode).toBe("split");
    act(() => result.current.setMode("full"));
    expect(result.current.split.mode).toBe("full");
    act(() => result.current.setMode("closed"));
    expect(result.current.split.mode).toBe("closed");
  });

  it("E8 direct closed↔full: select Chat from full lands in closed (never split between)", () => {
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper: wrapper("sE8") });
    const seen: string[] = [];
    act(() => result.current.setMode("full"));
    seen.push(result.current.split.mode);
    // From `full`, the header Chat segment sets `closed` directly.
    act(() => result.current.setMode("closed"));
    seen.push(result.current.split.mode);
    expect(seen).toEqual(["full", "closed"]);
    expect(seen).not.toContain("split");
  });

  it("F9 openers from full land in split, never full (openChanges + openInSplit)", () => {
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper: wrapper("sF9") });
    act(() => result.current.setMode("full"));
    expect(result.current.split.mode).toBe("full");
    // The Changed-Files chip drives openChanges(); from full it must move to split.
    act(() => result.current.openChanges());
    expect(result.current.split.mode).toBe("split");

    // A file opener from full likewise returns to split (chat stays visible).
    act(() => result.current.setMode("full"));
    act(() => result.current.openInSplit("src/foo.ts"));
    expect(result.current.split.mode).toBe("split");
  });

  it("openLiveTarget opens a live-server tab with the encoded path, idempotent on repeat", () => {
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper: wrapper("sLive") });
    expect(result.current.split.mode).toBe("closed");

    act(() => result.current.openLiveTarget("http://localhost:50452/report.html"));
    expect(result.current.split.mode).toBe("split");
    expect(result.current.paneState.openFiles.map((f) => f.path)).toEqual([
      "live:http://localhost:50452/report.html",
    ]);
    expect(result.current.paneState.openFiles[0].viewer).toBe("live-server");

    // Idempotent: re-opening the same URL reuses the tab (no duplicate).
    act(() => result.current.openLiveTarget("http://localhost:50452/report.html"));
    expect(result.current.paneState.openFiles).toHaveLength(1);

    // A distinct URL opens a distinct tab.
    act(() => result.current.openLiveTarget("http://localhost:50452/other.html"));
    expect(result.current.paneState.openFiles).toHaveLength(2);
  });

  it("useOptionalSplitWorkspace returns null outside a provider", () => {
    const { result } = renderHook(() => useOptionalSplitWorkspace());
    expect(result.current).toBeNull();
  });

  it("X1: malformed persisted split state falls back to closed, does not throw", () => {
    localStorage.setItem("pi-dashboard:split:sX1", "{not-valid-json");
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper: wrapper("sX1") });
    // Corrupt JSON → the loader swallows the parse error and returns the
    // default; the caption / restore-tab code renders against `closed`.
    expect(result.current.split.mode).toBe("closed");
  });
});

describe("SplitWorkspaceProvider — open-files watch + changed-on-disk", () => {
  beforeEach(() => localStorage.clear());

  it("declares open files to the watch when the split is open", () => {
    const onWatchFiles = vi.fn();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SplitWorkspaceProvider sessionId="sW" cwd="/proj" orientation="h" onWatchFiles={onWatchFiles}>
        {children}
      </SplitWorkspaceProvider>
    );
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper });
    // Closed on mount → declares an empty set.
    expect(onWatchFiles).toHaveBeenLastCalledWith("sW", "/proj", []);
    act(() => result.current.openInSplit("src/foo.ts"));
    expect(onWatchFiles).toHaveBeenLastCalledWith("sW", "/proj", ["src/foo.ts"]);
  });

  it("exposes changedFiles and forwards clearChanged to the prop", () => {
    const onClearChanged = vi.fn();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SplitWorkspaceProvider
        sessionId="sC"
        cwd="/proj"
        orientation="h"
        changedFiles={new Set(["src/foo.ts"])}
        onClearChanged={onClearChanged}
      >
        {children}
      </SplitWorkspaceProvider>
    );
    const { result } = renderHook(() => useSplitWorkspace(), { wrapper });
    expect(result.current.changedFiles?.has("src/foo.ts")).toBe(true);
    act(() => result.current.clearChanged("src/foo.ts"));
    expect(onClearChanged).toHaveBeenCalledWith("src/foo.ts");
  });
});
