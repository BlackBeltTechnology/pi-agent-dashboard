/**
 * Continue-resume uses the REST endpoint because it returns a definitive spawn
 * result. A dropped browser WebSocket frame must not leave the UI resuming
 * forever. Forks remain on the WebSocket path because they can carry entryId.
 */

import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSessionActions } from "../useSessionActions.js";

function endedSession(resuming = false): DashboardSession {
  return {
    id: "ended-session",
    cwd: "/repo",
    status: "ended",
    startedAt: Date.now(),
    sessionFile: "/repo/session.jsonl",
    resuming,
  } as DashboardSession;
}

function setup(resuming = false) {
  let sessions = new Map([["ended-session", endedSession(resuming)]]);
  let resumeErrors = new Map<string, string>();
  const setSessions = vi.fn((update: any) => {
    sessions = typeof update === "function" ? update(sessions) : update;
  });
  const setResumeErrors = vi.fn((update: any) => {
    resumeErrors = typeof update === "function" ? update(resumeErrors) : update;
  });
  const send = vi.fn();
  const deps: any = {
    selectedId: undefined,
    send,
    navigate: vi.fn(),
    setMobileOpen: vi.fn(),
    sessions,
    setSessions,
    setSessionStates: vi.fn(),
    setSpawningCwds: vi.fn(),
    setTerminals: vi.fn(),
    clearSpawningCwd: vi.fn(),
    spawnTimeoutsRef: { current: new Map() },
    pendingTerminalCwdRef: { current: null },
    terminals: new Map(),
    pendingSpawnsRef: { current: new Map() },
    setResumeErrors,
  };
  const { result } = renderHook(() => useSessionActions(deps));
  return { actions: result.current, send, getSessions: () => sessions, getResumeErrors: () => resumeErrors };
}

describe("useSessionActions continue resume", () => {
  it("uses the REST resume endpoint instead of an unreliable WebSocket frame", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { message: "spawned" } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { actions, send, getSessions } = setup();

    await actions.handleResumeSession("ended-session", "continue");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/session/ended-session/resume",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ mode: "continue" }),
      }),
    );
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "resume_session" }));
    expect(getSessions().get("ended-session")?.resuming).toBe(true);
  });

  it("clears resuming and surfaces the API error when resume fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: "keeper unavailable" }), { status: 500 }),
      ),
    );
    const { actions, getSessions, getResumeErrors } = setup();

    await actions.handleResumeSession("ended-session", "continue");

    await waitFor(() => {
      expect(getSessions().get("ended-session")?.resuming).toBe(false);
    });
    expect(getResumeErrors().get("ended-session")).toBe("keeper unavailable");
  });

  it("keeps forks on the WebSocket path so entryId remains supported", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { actions, send } = setup();

    await actions.handleResumeSession("ended-session", "fork", "entry-42");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "resume_session", mode: "fork", entryId: "entry-42" }),
    );
  });

  it("does not send a duplicate request while the session is already resuming", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { actions, send } = setup(true);

    await actions.handleResumeSession("ended-session", "continue");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
