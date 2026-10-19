/**
 * `file_changed` is a CANDIDATE: every event bumps a unique, monotonic
 * generation for its path (so a later event is never mistaken for one already
 * verified and cleared).
 * See change: gate-changed-on-disk-by-content (test-plan, task 5.1).
 */
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMessageHandler } from "../useMessageHandler.js";

function setup() {
  let state = new Map<string, Map<string, number>>();
  const setChangedOnDisk = vi.fn((upd: any) => {
    state = typeof upd === "function" ? upd(state) : upd;
  });
  const setters: any = new Proxy({}, { get: (_t, k) => (k === "setChangedOnDisk" ? setChangedOnDisk : vi.fn()) });
  const deps: any = {
    send: vi.fn(), navigate: vi.fn(), clearSpawningCwd: vi.fn(),
    spawningCwdsRef: { current: new Set() }, subscribedRef: { current: new Set() },
    pendingTerminalCwdRef: { current: null }, lastCreatedTerminalIdRef: { current: null },
    maxSeqMapRef: { current: new Map() }, selectedSessionIdRef: { current: undefined },
    pendingSpawnsRef: { current: new Map() }, loadingHistoryTimersRef: { current: new Map() },
  };
  const { result } = renderHook(() => useMessageHandler(setters, deps));
  return {
    fire: (sessionId: string, path: unknown) =>
      result.current({ type: "file_changed", sessionId, path } as unknown as ServerToBrowserMessage),
    get: () => state,
  };
}

describe("useMessageHandler file_changed", () => {
  it("two events for one path give two distinct, increasing generations", () => {
    const { fire, get } = setup();
    fire("s1", "foo.ts");
    const g1 = get().get("s1")?.get("foo.ts");
    fire("s1", "foo.ts");
    const g2 = get().get("s1")?.get("foo.ts");
    expect(typeof g1).toBe("number");
    expect(g2).toBeGreaterThan(g1 as number);
  });

  it("a generation never repeats after the entry is cleared", () => {
    const { fire, get } = setup();
    fire("s1", "foo.ts");
    const g1 = get().get("s1")?.get("foo.ts") as number;
    get().get("s1")?.delete("foo.ts"); // what a verified-equal clear does
    fire("s1", "foo.ts");
    expect(get().get("s1")?.get("foo.ts")).toBeGreaterThan(g1);
  });

  it("keeps sessions and paths separate and ignores malformed messages", () => {
    const { fire, get } = setup();
    fire("s1", "a.ts");
    fire("s2", "a.ts");
    fire("s1", "b.ts");
    fire("s1", 42);
    expect([...(get().get("s1")?.keys() ?? [])].sort()).toEqual(["a.ts", "b.ts"]);
    expect([...(get().get("s2")?.keys() ?? [])]).toEqual(["a.ts"]);
  });
});
