import { afterEach, describe, expect, it, vi } from "vitest";
import { wireEvents } from "../event-wiring.js";
import { createBrowserGateway } from "../pairing/browser-gateway.js";
import { createPendingForkRegistry } from "../pending/pending-fork-registry.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import { createReplayState } from "../session/hydration-state.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { makeFakeDirectoryService } from "./helpers/load-fixtures.js";

const SID = "model-state-regression";
const QWEN = "m5-qwen/halogen-qwen3.8-flash-next";
const BONSAI = "prism-local/bonsai2-27b-mtp";
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function makeRig() {
  const sessionManager = createMemorySessionManager();
  const eventStore = createMemoryEventStore(() => false);
  const replayState = createReplayState();
  const piGateway = {
    start: vi.fn(), stop: vi.fn(), sendToSession: vi.fn(),
    getConnectedSessionIds: vi.fn(() => []), isSessionConnected: vi.fn(() => true),
    clearHostPressure: vi.fn(), onEvent: vi.fn(),
  } as any;
  const browserGateway = createBrowserGateway(sessionManager, eventStore, piGateway);
  const broadcast = vi.spyOn(browserGateway, "broadcastSessionUpdated");
  wireEvents({
    sessionManager, eventStore, piGateway, browserGateway, replayState,
    sessionOrderManager: {
      insert: vi.fn(), remove: vi.fn(), getOrder: vi.fn(() => []),
      reorder: vi.fn(), getAllOrders: vi.fn(() => ({})),
      moveToFront: vi.fn(), rekey: vi.fn(),
    } as any,
    preferencesStore: {
      getPinnedDirectories: () => [], setPinnedDirectories: () => {},
      getSessionOrder: () => ({}), setSessionOrder: () => {},
      getAutoNameSessions: () => false,
    } as any,
    pendingForkRegistry: createPendingForkRegistry(),
    directoryService: makeFakeDirectoryService().service,
    knownSessionIds: new Set<string>(), pendingDashboardSpawns: new Map<string, number>(),
  });
  // The gateway registers the live model before delivering replay frames.
  sessionManager.register({
    id: SID, cwd: "/tmp/model-state-test", source: "dashboard", model: QWEN,
    thinkingLevel: "high", startedAt: 1,
  } as any);
  const event = (eventType: string, data: Record<string, unknown>, replay = false) =>
    piGateway.onEvent(SID, {
      type: "event_forward", sessionId: SID, ...(replay ? { replay: true } : {}),
      event: { eventType, timestamp: Date.now(), data },
    });
  cleanups.push(() => replayState.controller.release(SID));
  return { sessionManager, eventStore, replayState, broadcast, event };
}

const historicalSelection = {
  model: { provider: "prism-local", id: "bonsai2-27b-mtp" }, thinkingLevel: "low",
};

describe("event-wiring: current model is not historical model state", () => {
  it.each([false, true])("preserves the registered snapshot during replay (skipWipe=%s)", (skipped) => {
    const { sessionManager, eventStore, replayState, event } = makeRig();
    replayState.controller.begin(SID, { skipped });
    event("model_select", historicalSelection, true);
    expect(sessionManager.get(SID)).toMatchObject({ model: QWEN, thinkingLevel: "high" });
    // Still keep the historical selection for transcript replay, unless the
    // identical history is already resident (skipWipe).
    if (!skipped) {
      expect(eventStore.getEvents(SID, 1)).toEqual(expect.arrayContaining([
        expect.objectContaining({ event: expect.objectContaining({ eventType: "model_select", data: historicalSelection }) }),
      ]));
    }
  });

  it("ignores a late marked historical selection after replay has completed", () => {
    const { sessionManager, event } = makeRig();
    event("model_select", historicalSelection, true);
    expect(sessionManager.get(SID)).toMatchObject({ model: QWEN, thinkingLevel: "high" });
  });

  it.each([false, true])("honors a live selection inside an open replay window (skipWipe=%s)", (skipped) => {
    const { sessionManager, replayState, event } = makeRig();
    replayState.controller.begin(SID, { skipped });
    event("model_select", historicalSelection);
    expect(sessionManager.get(SID)).toMatchObject({ model: BONSAI, thinkingLevel: "low" });
    event("model_select", {
      model: { provider: "m5-qwen", id: "halogen-qwen3.8-flash-next" }, thinkingLevel: "high",
    }, true);
    expect(sessionManager.get(SID)).toMatchObject({ model: BONSAI, thinkingLevel: "low" });
  });

  it("still honors a later live user selection", () => {
    const { sessionManager, broadcast, event } = makeRig();
    event("model_select", historicalSelection);
    expect(sessionManager.get(SID)).toMatchObject({ model: BONSAI, thinkingLevel: "low" });
    expect(broadcast).toHaveBeenCalledWith(SID, { model: BONSAI, thinkingLevel: "low" });
  });
});
