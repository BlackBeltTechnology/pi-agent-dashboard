/**
 * `onSpawnFailed` — the folder home re-enables Start only for ITS spawn.
 * test-plan F8 (hook level), F9, X7. See change: redesign-directory-home-split.
 */
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { renderHook } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { type SpawnErrorDetail, useMessageHandler } from "../useMessageHandler.js";
import type { PendingSpawnEntry } from "../useSessionActions.js";

function setup(entries: Record<string, PendingSpawnEntry> = {}) {
  const pending = new Map<string, PendingSpawnEntry>(Object.entries(entries));
  const onSpawnFailed = vi.fn();
  // Stateful stand-in so tests can observe the banner map the handler builds.
  const spawnErrors = new Map<string, SpawnErrorDetail>();
  const setSpawnErrors = vi.fn((u: React.SetStateAction<Map<string, SpawnErrorDetail>>) => {
    const next = typeof u === "function" ? u(new Map(spawnErrors)) : u;
    spawnErrors.clear();
    for (const [k, v] of next) spawnErrors.set(k, v);
  });
  const navigate = vi.fn();
  const setters: any = {
    setSessions: vi.fn(), setSessionStates: vi.fn(), setSessionCommands: vi.fn(),
    setFileResults: vi.fn(), setOpenspecMap: vi.fn(), setOpenspecGroupsMap: vi.fn(),
    setModelsMap: vi.fn(), setRolesMap: vi.fn(), setSpawnResult: vi.fn(),
    setSessionOrderMap: vi.fn(), setPinnedDirectories: vi.fn(), setFavoriteModels: vi.fn(),
    setWorkspaces: vi.fn(), setTerminals: vi.fn(), setEditorStatuses: vi.fn(),
    setDiscoveredServers: vi.fn(), setSpawnErrors, setResumeErrors: vi.fn(),
    setDisplayPrefs: vi.fn(),
  };
  const deps: any = {
    send: vi.fn(),
    navigate,
    clearSpawningCwd: vi.fn(),
    spawningCwdsRef: { current: new Set<string>() },
    subscribedRef: { current: new Set<string>() },
    pendingTerminalCwdRef: { current: null },
    lastCreatedTerminalIdRef: { current: null },
    maxSeqMapRef: { current: new Map<string, number>() },
    selectedSessionIdRef: { current: undefined },
    pendingSpawnsRef: { current: pending },
    onSpawnFailed,
  };
  const { result } = renderHook(() => useMessageHandler(setters, deps));
  return { dispatch: (m: unknown) => result.current(m as ServerToBrowserMessage), onSpawnFailed, navigate, pending, spawnErrors };
}

describe("useMessageHandler — onSpawnFailed", () => {
  it("a failed spawn_result echoing a requestId notifies once with that id", () => {
    const { dispatch, onSpawnFailed } = setup({ R: { cwd: "/p", kind: "spawn" } });
    dispatch({ type: "spawn_result", cwd: "/p", success: false, message: "boom", requestId: "R" });
    expect(onSpawnFailed).toHaveBeenCalledTimes(1);
    expect(onSpawnFailed).toHaveBeenCalledWith("R");
  });

  it("a successful spawn_result never notifies", () => {
    const { dispatch, onSpawnFailed } = setup({ R: { cwd: "/p", kind: "spawn" } });
    dispatch({ type: "spawn_result", cwd: "/p", success: true, message: "ok", requestId: "R" });
    expect(onSpawnFailed).not.toHaveBeenCalled();
  });

  it("a spawn_register_timeout echoing a requestId notifies with it; one without does not", () => {
    const { dispatch, onSpawnFailed } = setup();
    dispatch({ type: "spawn_register_timeout", cwd: "/p", requestId: "R2" });
    expect(onSpawnFailed).toHaveBeenCalledWith("R2");
    onSpawnFailed.mockClear();
    dispatch({ type: "spawn_register_timeout", cwd: "/p" });
    expect(onSpawnFailed).not.toHaveBeenCalled();
  });

  it("F9/X7: session_added with the spawnRequestId navigates exactly once (App owns navigation)", () => {
    const { dispatch, navigate, onSpawnFailed } = setup({ R: { cwd: "/p", kind: "spawn" } });
    dispatch({
      type: "session_added",
      session: { id: "s1", cwd: "/p", source: "tui", status: "active", startedAt: 1 } as DashboardSession,
      spawnRequestId: "R",
    });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/session/s1");
    expect(onSpawnFailed).not.toHaveBeenCalled();
  });
});

/** See change: fix-session-bridge-registration (test-plan E25, F1). */
describe("useMessageHandler — terminated timeout evidence", () => {
  it("E25: keeps terminated/terminatedPids when present, leaves them undefined when absent", () => {
    const { dispatch, spawnErrors, onSpawnFailed } = setup();
    dispatch({ type: "spawn_register_timeout", cwd: "/p/a", pid: 123, timeoutMs: 30000, terminated: true, terminatedPids: [123] });
    const withEvidence = spawnErrors.get("/p/a")!;
    expect(withEvidence.kind).toBe("timeout");
    expect(withEvidence.terminated).toBe(true);
    expect(withEvidence.terminatedPids).toEqual([123]);

    dispatch({ type: "spawn_register_timeout", cwd: "/p/b", pid: 123, timeoutMs: 30000 });
    const without = spawnErrors.get("/p/b")!;
    expect(without.terminated).toBeUndefined();
    expect(without.terminatedPids).toBeUndefined();
    expect("terminated" in without && without.terminated === false).toBe(false);

    // requestId notify behaviour unchanged.
    dispatch({ type: "spawn_register_timeout", cwd: "/p/c", requestId: "R", terminated: true, terminatedPids: [1] });
    expect(onSpawnFailed).toHaveBeenCalledWith("R");
  });

  it("F1: recovered and a successful spawn_result clear the terminated banner; a second timeout replaces the first", () => {
    const { dispatch, spawnErrors } = setup();
    const timeout = { type: "spawn_register_timeout", cwd: "/p/x", pid: 1, timeoutMs: 30000, terminated: true, terminatedPids: [1] };

    dispatch(timeout);
    expect(spawnErrors.has("/p/x")).toBe(true);
    dispatch({ type: "spawn_register_recovered", cwd: "/p/x" });
    expect(spawnErrors.has("/p/x")).toBe(false);

    dispatch(timeout);
    dispatch({ type: "spawn_result", cwd: "/p/x", success: true, message: "ok" });
    expect(spawnErrors.has("/p/x")).toBe(false);

    dispatch(timeout);
    dispatch({ ...timeout, pid: 2, terminatedPids: [2] });
    expect(spawnErrors.size).toBe(1);
    expect(spawnErrors.get("/p/x")!.pid).toBe(2);
    expect(spawnErrors.get("/p/x")!.terminatedPids).toEqual([2]);
  });
});
