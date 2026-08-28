/**
 * Change: restore-assistant-greeting-stream
 *
 * useMessageHandler routes greeting `ib_domain_event` frames (live and replayed)
 * into the originating session's chat rows. Proves the LIVE path end-to-end at
 * the dispatch seam:
 *  - a live greeting stamped with the server `greetingId`/`greetingOrder` folds
 *    into exactly one chat row carrying its structured `state`;
 *  - a live greeting WITHOUT `greetingId` still folds, keyed by the producer's
 *    `state` field (design D3) — this is the second silent-drop the re-gate found;
 *  - live + replay of the SAME greeting dedupe to one row;
 *  - a non-greeting ib_domain_event produces NO chat row (shell ignores it);
 *  - a greeting folded BEFORE the per-session event_replay survives the reset
 *    (the connect-order hazard).
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMessageHandler } from "../useMessageHandler.js";
import { type SessionState } from "../../lib/chat/event-reducer.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

function setup() {
  const sessionStatesRef = { current: new Map<string, SessionState>() };
  const setSessionStates = vi.fn((updater: any) => {
    sessionStatesRef.current =
      typeof updater === "function" ? updater(sessionStatesRef.current) : updater;
  });
  const setters: any = {
    setSessions: vi.fn(), setSessionStates, setSessionCommands: vi.fn(),
    setSessionFlows: vi.fn(), setFileResults: vi.fn(), setOpenspecMap: vi.fn(),
    setModelsMap: vi.fn(), setRolesMap: vi.fn(), setSpawnResult: vi.fn(),
    setSessionOrderMap: vi.fn(), setPinnedDirectories: vi.fn(), setFavoriteModels: vi.fn(),
    setTerminals: vi.fn(), setEditorStatuses: vi.fn(), setDiscoveredServers: vi.fn(),
    setSpawnErrors: vi.fn(), setResumeErrors: vi.fn(), setLoadingHistory: vi.fn(),
    setReplayInFlight: vi.fn(),
  };
  const deps: any = {
    send: vi.fn(), navigate: vi.fn(), clearSpawningCwd: vi.fn(),
    spawningCwdsRef: { current: new Set() }, subscribedRef: { current: new Set() },
    pendingTerminalCwdRef: { current: null }, lastCreatedTerminalIdRef: { current: null },
    maxSeqMapRef: { current: new Map<string, number>() },
    selectedSessionIdRef: { current: undefined },
    loadingHistoryTimersRef: { current: new Map() },
    replayInFlightTimersRef: { current: new Map() },
  };
  const { result } = renderHook(() => useMessageHandler(setters, deps));
  return { dispatch: (m: ServerToBrowserMessage) => result.current(m), sessionStatesRef };
}

const SID = "session-1";

function liveGreeting(data: Record<string, unknown>, extra: Record<string, unknown> = {}): ServerToBrowserMessage {
  return { type: "ib_domain_event", sessionId: SID, event: { eventType: "ib_greeting", data }, ...extra } as ServerToBrowserMessage;
}
function greetingRows(ref: { current: Map<string, SessionState> }) {
  return (ref.current.get(SID)?.messages ?? []).filter((m) => m.state !== undefined);
}

describe("useMessageHandler greeting fold — live path", () => {
  it("folds a live greeting stamped with greetingId/greetingOrder into one row carrying state", () => {
    const { dispatch, sessionStatesRef } = setup();
    dispatch(liveGreeting(
      { state: "exported", content: "Kész", details: { state: "exported" } },
      { greetingId: "exported", greetingOrder: 1000 },
    ));
    const rows = greetingRows(sessionStatesRef);
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("exported");
    expect(rows[0].content).toBe("Kész");
    expect(rows[0].timestamp).toBe(1000);
  });

  it("folds a live greeting WITHOUT greetingId, keyed by the producer state field", () => {
    const { dispatch, sessionStatesRef } = setup();
    // No greetingId/greetingOrder — the second silent-drop before the fix.
    dispatch(liveGreeting({ state: "partner_pending", content: "Vár", details: { state: "partner_pending" } }));
    const rows = greetingRows(sessionStatesRef);
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("partner_pending");
    expect(rows[0].id).toBe("greeting-partner_pending");
  });

  it("dedupes live + replay of the same greeting to a single row", () => {
    const { dispatch, sessionStatesRef } = setup();
    dispatch(liveGreeting(
      { state: "exported", content: "replayed", details: { state: "exported" } },
      { replay: true, greetingId: "exported", greetingOrder: 1000 },
    ));
    dispatch(liveGreeting(
      { state: "exported", content: "live", details: { state: "exported" } },
      { greetingId: "exported", greetingOrder: 1000 },
    ));
    expect(greetingRows(sessionStatesRef)).toHaveLength(1);
  });

  it("ignores a non-greeting ib_domain_event (no chat row)", () => {
    const { dispatch, sessionStatesRef } = setup();
    dispatch({
      type: "ib_domain_event", sessionId: SID,
      event: { eventType: "ib_invoice_state_changed", data: { invoice_id: "inv1", state: "exported" } },
    } as ServerToBrowserMessage);
    expect(sessionStatesRef.current.get(SID)?.messages ?? []).toHaveLength(0);
  });

  it("a greeting folded before event_replay survives the connect-time reset", () => {
    const { dispatch, sessionStatesRef } = setup();
    // App-level greeting replay lands FIRST (before per-session event_replay).
    dispatch(liveGreeting(
      { state: "exported", content: "early", details: { state: "exported" } },
      { replay: true, greetingId: "exported", greetingOrder: 500 },
    ));
    expect(greetingRows(sessionStatesRef)).toHaveLength(1);
    // Per-session event_replay (firstSeq=1) triggers a full-sweep reset.
    dispatch({
      type: "event_replay", sessionId: SID,
      events: [{ seq: 1, event: { eventType: "agent_start", timestamp: 600, data: {} } as DashboardEvent }],
    } as ServerToBrowserMessage);
    const rows = greetingRows(sessionStatesRef);
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("exported");
  });
});
