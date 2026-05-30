/**
 * Tests for the off-screen `spawn_error` toast fallback added in change
 * `harden-worktree-spawn`. Verifies that:
 *   - visible cwd → NO toast (existing per-folder banner is canonical)
 *   - off-screen cwd → toast enqueued via the bus
 *   - bus toast carries cwd + code + message body
 *   - path-key normalization (trailing slash, win32 case) does NOT
 *     produce false toasts for visible-with-drift cwds
 *
 * Bus state is reset between cases via __resetSpawnErrorToastBusForTests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMessageHandler } from "../useMessageHandler.js";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import {
  __resetSpawnErrorToastBusForTests,
  subscribeSpawnErrorToasts,
  type SpawnErrorToastEntry,
} from "../../lib/spawn-error-toast-bus.js";

function setupHandler(visibilityInputs: {
  pinnedDirectories: ReadonlyArray<string>;
  workspaces: ReadonlyArray<{ folders: ReadonlyArray<string> }>;
  sessions: ReadonlyArray<{ cwd: string }>;
}) {
  const setters: any = {
    setSessions: vi.fn(), setSessionStates: vi.fn(), setSessionCommands: vi.fn(),
    setSessionFlows: vi.fn(), setFileResults: vi.fn(), setOpenspecMap: vi.fn(),
    setOpenspecGroupsMap: vi.fn(), setModelsMap: vi.fn(), setRolesMap: vi.fn(),
    setSpawnResult: vi.fn(), setSessionOrderMap: vi.fn(), setPinnedDirectories: vi.fn(),
    setWorkspaces: vi.fn(), setTerminals: vi.fn(), setEditorStatuses: vi.fn(),
    setDiscoveredServers: vi.fn(), setSpawnErrors: vi.fn(), setResumeErrors: vi.fn(),
  };
  const cwdVisibilityInputsRef = { current: visibilityInputs };
  const deps: any = {
    send: vi.fn(), navigate: vi.fn(), clearSpawningCwd: vi.fn(),
    spawningCwdsRef: { current: new Set() }, subscribedRef: { current: new Set() },
    pendingTerminalCwdRef: { current: null }, lastCreatedTerminalIdRef: { current: null },
    maxSeqMapRef: { current: new Map() }, selectedSessionIdRef: { current: undefined },
    pendingSpawnsRef: { current: new Map() },
    cwdVisibilityInputsRef,
  };
  const { result } = renderHook(() => useMessageHandler(setters, deps));
  const dispatch = (msg: ServerToBrowserMessage) => result.current(msg);
  return { dispatch };
}

function snapshotToasts(): ReadonlyArray<SpawnErrorToastEntry> {
  let captured: ReadonlyArray<SpawnErrorToastEntry> = [];
  const unsub = subscribeSpawnErrorToasts((entries) => { captured = entries; });
  unsub();
  return captured;
}

beforeEach(() => {
  __resetSpawnErrorToastBusForTests();
});

describe("useMessageHandler — spawn_error off-screen toast", () => {
  it("NO toast when cwd is pinned", () => {
    const { dispatch } = setupHandler({
      pinnedDirectories: ["/repo"],
      workspaces: [], sessions: [],
    });
    dispatch({
      type: "spawn_error", cwd: "/repo", strategy: "tmux",
      message: "boom", code: "SPAWN_ERRNO",
    } as any);
    expect(snapshotToasts().length).toBe(0);
  });

  it("NO toast when cwd is in a workspace folder", () => {
    const { dispatch } = setupHandler({
      pinnedDirectories: [],
      workspaces: [{ folders: ["/repo"] }],
      sessions: [],
    });
    dispatch({ type: "spawn_error", cwd: "/repo", strategy: "x", message: "x" } as any);
    expect(snapshotToasts().length).toBe(0);
  });

  it("NO toast when cwd matches an existing session", () => {
    const { dispatch } = setupHandler({
      pinnedDirectories: [], workspaces: [],
      sessions: [{ cwd: "/repo" }],
    });
    dispatch({ type: "spawn_error", cwd: "/repo", strategy: "x", message: "x" } as any);
    expect(snapshotToasts().length).toBe(0);
  });

  it("Toast fires when cwd is off-screen (not pinned, not in any workspace, no session)", () => {
    const { dispatch } = setupHandler({
      pinnedDirectories: ["/repo"], workspaces: [], sessions: [],
    });
    dispatch({
      type: "spawn_error", cwd: "/Users/dev/proj-X", strategy: "tmux",
      message: "Pi session spawned but never registered (timeout 30000ms)",
      code: "REGISTER_TIMEOUT",
    } as any);
    const toasts = snapshotToasts();
    expect(toasts.length).toBe(1);
    expect(toasts[0].message).toContain("REGISTER_TIMEOUT");
    expect(toasts[0].message).toContain("/Users/dev/proj-X");
  });

  it("Trailing-slash drift on pinned dir suppresses toast", () => {
    const { dispatch } = setupHandler({
      pinnedDirectories: ["/repo/"], workspaces: [], sessions: [],
    });
    dispatch({ type: "spawn_error", cwd: "/repo", strategy: "x", message: "x" } as any);
    expect(snapshotToasts().length).toBe(0);
  });

  it("No deps.cwdVisibilityInputsRef → fallback to NO toast (back-compat)", () => {
    // setupHandler always passes the ref; here we explicitly omit it.
    const setters: any = {
      setSessions: vi.fn(), setSessionStates: vi.fn(), setSessionCommands: vi.fn(),
      setSessionFlows: vi.fn(), setFileResults: vi.fn(), setOpenspecMap: vi.fn(),
      setOpenspecGroupsMap: vi.fn(), setModelsMap: vi.fn(), setRolesMap: vi.fn(),
      setSpawnResult: vi.fn(), setSessionOrderMap: vi.fn(), setPinnedDirectories: vi.fn(),
      setWorkspaces: vi.fn(), setTerminals: vi.fn(), setEditorStatuses: vi.fn(),
      setDiscoveredServers: vi.fn(), setSpawnErrors: vi.fn(), setResumeErrors: vi.fn(),
    };
    const deps: any = {
      send: vi.fn(), navigate: vi.fn(), clearSpawningCwd: vi.fn(),
      spawningCwdsRef: { current: new Set() }, subscribedRef: { current: new Set() },
      pendingTerminalCwdRef: { current: null }, lastCreatedTerminalIdRef: { current: null },
      maxSeqMapRef: { current: new Map() }, selectedSessionIdRef: { current: undefined },
      pendingSpawnsRef: { current: new Map() },
    };
    const { result } = renderHook(() => useMessageHandler(setters, deps));
    result.current({ type: "spawn_error", cwd: "/anywhere", strategy: "x", message: "x" } as any);
    expect(snapshotToasts().length).toBe(0);
  });

  it("Truncates message body to <= 200 chars", () => {
    const { dispatch } = setupHandler({ pinnedDirectories: [], workspaces: [], sessions: [] });
    const longMsg = "x".repeat(500);
    dispatch({ type: "spawn_error", cwd: "/x", strategy: "x", message: longMsg, code: "X" } as any);
    const toasts = snapshotToasts();
    expect(toasts.length).toBe(1);
    expect(toasts[0].message.length).toBeLessThanOrEqual(200);
  });
});
