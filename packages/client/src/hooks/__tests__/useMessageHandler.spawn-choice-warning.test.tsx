/**
 * A successful spawn_result carrying `choiceWarning` shows a warning toast and
 * is NOT treated as a failed spawn.
 * test-plan: F2. See change: add-spawn-model-choice.
 * Exemplar: useMessageHandler.spawn-error-toast.test.tsx.
 */
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMessageHandler } from "../useMessageHandler.js";

function setup() {
  const setters: any = {
    setSessions: vi.fn(), setSessionStates: vi.fn(), setSessionCommands: vi.fn(),
    setSessionFlows: vi.fn(), setFileResults: vi.fn(), setOpenspecMap: vi.fn(),
    setOpenspecGroupsMap: vi.fn(), setModelsMap: vi.fn(), setRolesMap: vi.fn(),
    setSpawnResult: vi.fn(), setSessionOrderMap: vi.fn(), setPinnedDirectories: vi.fn(), setFavoriteModels: vi.fn(),
    setWorkspaces: vi.fn(), setTerminals: vi.fn(), setEditorStatuses: vi.fn(),
    setDiscoveredServers: vi.fn(), setSpawnErrors: vi.fn(), setResumeErrors: vi.fn(),
  };
  const showToast = vi.fn();
  const onSpawnFailed = vi.fn();
  const clearSpawningCwd = vi.fn();
  const deps: any = {
    send: vi.fn(), navigate: vi.fn(), clearSpawningCwd,
    spawningCwdsRef: { current: new Set() }, subscribedRef: { current: new Set() },
    pendingTerminalCwdRef: { current: null }, lastCreatedTerminalIdRef: { current: null },
    maxSeqMapRef: { current: new Map() }, selectedSessionIdRef: { current: undefined },
    pendingSpawnsRef: { current: new Map([["req-1", { cwd: "/p" }]]) },
    cwdVisibilityInputsRef: { current: { pinnedDirectories: [], workspaces: [], sessions: [] } },
    showToast, onSpawnFailed,
  };
  const { result } = renderHook(() => useMessageHandler(setters, deps));
  return { dispatch: (m: ServerToBrowserMessage) => result.current(m), showToast, onSpawnFailed, clearSpawningCwd, deps };
}

describe("spawn_result choiceWarning", () => {
  it("F2: warning toast once; spawn not marked failed", () => {
    const { dispatch, showToast, onSpawnFailed, clearSpawningCwd, deps } = setup();
    dispatch({
      type: "spawn_result", cwd: "/p", success: true, message: "ok", requestId: "req-1",
      choiceWarning: "role 'ghost' not configured yet",
    });
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("role 'ghost' not configured yet", "warning");
    expect(onSpawnFailed).not.toHaveBeenCalled();
    expect(clearSpawningCwd).not.toHaveBeenCalled();
    expect(deps.pendingSpawnsRef.current.has("req-1")).toBe(true);
  });

  it("no choiceWarning → no toast", () => {
    const { dispatch, showToast } = setup();
    dispatch({ type: "spawn_result", cwd: "/p", success: true, message: "ok" });
    expect(showToast).not.toHaveBeenCalled();
  });
});
