/**
 * `file_changed` feeds the per-session `changedOnDisk` map with a monotonically
 * increasing generation per event, so every event is a fresh verification
 * candidate. See change: gate-changed-on-disk-by-content (task 5.1).
 */
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMessageHandler } from "../useMessageHandler.js";

function setup() {
  let state = new Map<string, Map<string, number>>();
  const setChangedOnDisk = vi.fn((u: unknown) => {
    state = typeof u === "function" ? (u as (p: typeof state) => typeof state)(state) : (u as typeof state);
  });
  const setters: any = new Proxy({ setChangedOnDisk }, { get: (t: any, k) => (k in t ? t[k] : vi.fn()) });
  const deps: any = {
    send: vi.fn(), navigate: vi.fn(), clearSpawningCwd: vi.fn(),
    spawningCwdsRef: { current: new Set() }, subscribedRef: { current: new Set() },
    pendingTerminalCwdRef: { current: null }, lastCreatedTerminalIdRef: { current: null },
    maxSeqMapRef: { current: new Map() }, selectedSessionIdRef: { current: undefined },
    pendingSpawnsRef: { current: new Map() }, loadingHistoryTimersRef: { current: new Map() },
  };
  const { result } = renderHook(() => useMessageHandler(setters, deps));
  return { dispatch: (m: unknown) => result.current(m as ServerToBrowserMessage), get: () => state };
}

describe("useMessageHandler file_changed generations", () => {
  it("two events for one path give two distinct, increasing generations", () => {
    const { dispatch, get } = setup();
    dispatch({ type: "file_changed", sessionId: "s1", path: "a.ts" });
    const g1 = get().get("s1")?.get("a.ts");
    dispatch({ type: "file_changed", sessionId: "s1", path: "a.ts" });
    const g2 = get().get("s1")?.get("a.ts");
    expect(typeof g1).toBe("number");
    expect(g2).toBeGreaterThan(g1 as number);
  });

  it("generation keeps increasing after the entry is cleared and re-added", () => {
    const { dispatch, get } = setup();
    dispatch({ type: "file_changed", sessionId: "s1", path: "a.ts" });
    const g1 = get().get("s1")?.get("a.ts") as number;
    get().get("s1")?.delete("a.ts");
    dispatch({ type: "file_changed", sessionId: "s1", path: "a.ts" });
    expect(get().get("s1")?.get("a.ts")).toBeGreaterThan(g1);
  });

  it("keeps sessions separate", () => {
    const { dispatch, get } = setup();
    dispatch({ type: "file_changed", sessionId: "s1", path: "a.ts" });
    dispatch({ type: "file_changed", sessionId: "s2", path: "b.ts" });
    expect([...(get().get("s1")?.keys() ?? [])]).toEqual(["a.ts"]);
    expect([...(get().get("s2")?.keys() ?? [])]).toEqual(["b.ts"]);
  });
});
