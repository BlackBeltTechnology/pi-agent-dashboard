/**
 * `session_orphaned` must reach the user.
 *
 * The server broadcasts it when a session's process outlived SIGTERM → SIGKILL,
 * ALONGSIDE `session_removed` (the record is still released so the session
 * cannot wedge the UI). Without a handler the user sees an ordinary, successful
 * looking close while a ~127 MB `pi` stays resident — the indistinguishability
 * that hid #452 for weeks. Ordering matters too: the orphan warning arrives
 * first, and the subsequent removal must not cancel it.
 *
 * Pattern: `useMessageHandler.auto-name-error.test.tsx` (the other toast-on
 * message path).
 *
 * See change: fix-tmux-session-shutdown-leak (requirement C2).
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
  return { dispatch: (m: ServerToBrowserMessage) => result.current(m), showToast, setters };
}

describe("useMessageHandler session_orphaned", () => {
  it("warns the user and names the surviving pid", () => {
    const { dispatch, showToast } = setup();

    dispatch({ type: "session_orphaned", sessionId: "s1", pid: 18163 } as ServerToBrowserMessage);

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(
      String(showToast.mock.calls[0][0]),
      "the warning does not name the process that is still running",
    ).toContain("18163");
    expect(showToast.mock.calls[0][1]).toBe("error");
  });

  it("the following session_removed does not suppress the warning", () => {
    // The pair always arrives together, orphan first. A handler that only ran
    // on the terminal message would show a clean close for a leaked process.
    const { dispatch, showToast } = setup();

    dispatch({ type: "session_orphaned", sessionId: "s1", pid: 18163 } as ServerToBrowserMessage);
    dispatch({ type: "session_removed", sessionId: "s1" } as ServerToBrowserMessage);

    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("a clean shutdown (session_removed alone) shows nothing", () => {
    const { dispatch, showToast } = setup();

    dispatch({ type: "session_removed", sessionId: "s1" } as ServerToBrowserMessage);

    expect(showToast).not.toHaveBeenCalled();
  });
});
