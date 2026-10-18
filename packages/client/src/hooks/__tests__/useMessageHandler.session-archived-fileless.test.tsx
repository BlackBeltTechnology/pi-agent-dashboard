/**
 * Suite for change: fix-orphaned-ended-session-archive (test-plan #F2).
 *
 * A fileless-eviction `session_archived` carries the UNCHANGED folder count.
 * The client must delete the card and keep the archived count as sent.
 */
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMessageHandler } from "../useMessageHandler.js";

describe("useMessageHandler session_archived (fileless eviction)", () => {
  it("removes the card and keeps the archived count unchanged", () => {
    let sessions = new Map<string, DashboardSession>([
      ["S", { id: "S", cwd: "/w", status: "ended", source: "tui", startedAt: 1 } as DashboardSession],
    ]);
    let counts = new Map<string, number>([["/w", 3]]);
    const setters: any = {
      setSessions: vi.fn((u: any) => { sessions = typeof u === "function" ? u(sessions) : u; }),
      setArchivedCountMap: vi.fn((u: any) => { counts = typeof u === "function" ? u(counts) : u; }),
      setSessionStates: vi.fn(), setSessionCommands: vi.fn(),
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
      showToast: vi.fn(),
    };
    const { result } = renderHook(() => useMessageHandler(setters, deps));

    result.current({ type: "session_archived", sessionId: "S", cwd: "/w", count: 3 } as ServerToBrowserMessage);

    expect(sessions.has("S")).toBe(false);
    expect(counts.get("/w")).toBe(3);
  });
});
