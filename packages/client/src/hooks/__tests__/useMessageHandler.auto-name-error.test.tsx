/**
 * Suite for change: add-auto-session-naming.
 *
 * Pins the `auto_name_error` handling in useMessageHandler: a toast is shown
 * on receipt, and it is one-shot per session (a second error for the same
 * session id does not re-toast; a different session does).
 */
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMessageHandler } from "../useMessageHandler.js";

function setup() {
  const showToast = vi.fn();
  const setters: any = {
    setSessions: vi.fn(), setSessionStates: vi.fn(), setSessionCommands: vi.fn(),
    setFileResults: vi.fn(), setOpenspecMap: vi.fn(), setModelsMap: vi.fn(),
    setRolesMap: vi.fn(), setSpawnResult: vi.fn(), setSessionOrderMap: vi.fn(),
    setPinnedDirectories: vi.fn(), setFavoriteModels: vi.fn(), setTerminals: vi.fn(),
    setEditorStatuses: vi.fn(), setDiscoveredServers: vi.fn(), setSpawnErrors: vi.fn(),
    setResumeErrors: vi.fn(), setLoadingHistory: vi.fn(),
  };
  const deps: any = {
    send: vi.fn(), navigate: vi.fn(), clearSpawningCwd: vi.fn(),
    spawningCwdsRef: { current: new Set() }, subscribedRef: { current: new Set() },
    pendingTerminalCwdRef: { current: null }, lastCreatedTerminalIdRef: { current: null },
    maxSeqMapRef: { current: new Map() }, selectedSessionIdRef: { current: undefined },
    pendingSpawnsRef: { current: new Map() }, loadingHistoryTimersRef: { current: new Map() },
    showToast,
  };
  const { result } = renderHook(() => useMessageHandler(setters, deps));
  return { dispatch: (m: ServerToBrowserMessage) => result.current(m), showToast };
}

describe("useMessageHandler auto_name_error", () => {
  it("shows a toast on receipt", () => {
    const { dispatch, showToast } = setup();
    dispatch({ type: "auto_name_error", sessionId: "s1", reason: "@fast not configured" } as ServerToBrowserMessage);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0][0]).toContain("@fast not configured");
    expect(showToast.mock.calls[0][1]).toBe("error");
  });

  it("is one-shot per session (no repeat for the same session)", () => {
    const { dispatch, showToast } = setup();
    dispatch({ type: "auto_name_error", sessionId: "s1", reason: "boom" } as ServerToBrowserMessage);
    dispatch({ type: "auto_name_error", sessionId: "s1", reason: "boom again" } as ServerToBrowserMessage);
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("toasts separately for a different session", () => {
    const { dispatch, showToast } = setup();
    dispatch({ type: "auto_name_error", sessionId: "s1", reason: "a" } as ServerToBrowserMessage);
    dispatch({ type: "auto_name_error", sessionId: "s2", reason: "b" } as ServerToBrowserMessage);
    expect(showToast).toHaveBeenCalledTimes(2);
  });
});
