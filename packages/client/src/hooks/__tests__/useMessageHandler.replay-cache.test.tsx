import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { renderHook } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type CachedEvent, createReplayCache } from "../../lib/replay/replay-cache.js";
import { createReplayPersister } from "../../lib/replay/replay-persist.js";
import { type MessageHandlerSetters, useMessageHandler } from "../useMessageHandler.js";

function noopSetters(): MessageHandlerSetters {
  return new Proxy({}, { get: () => vi.fn() }) as unknown as MessageHandlerSetters;
}

function liveEvent(sessionId: string, seq: number): Extract<ServerToBrowserMessage, { type: "event" }> {
  return {
    type: "event",
    sessionId,
    seq,
    event: { sessionId, eventType: "message_end", timestamp: seq, data: {} } as unknown as DashboardEvent,
  };
}

const KEY = "a:8000";

describe("useMessageHandler — Strategy A replay-cache invalidation", () => {
  let factory: IDBFactory;
  beforeEach(() => {
    factory = new IDBFactory();
  });

  it("session_state_reset purges the persisted cache entry", async () => {
    const cache = createReplayCache({ factory });
    const persister = createReplayPersister(cache, 0, () => KEY);

    const { result } = renderHook(() => {
      const maxSeqMapRef = useRef(new Map<string, number>());
      const deps: any = {
        send: vi.fn(),
        navigate: vi.fn(),
        clearSpawningCwd: vi.fn(),
        spawningCwdsRef: useRef(new Set<string>()),
        subscribedRef: useRef(new Set<string>()),
        pendingTerminalCwdRef: useRef(null),
        lastCreatedTerminalIdRef: useRef(null),
        maxSeqMapRef,
        selectedSessionIdRef: useRef(undefined),
        pendingSpawnsRef: useRef(new Map()),
        loadingHistoryTimersRef: useRef(new Map()),
        replayInFlightTimersRef: useRef(new Map()),
        replayPersister: persister,
      };
      return useMessageHandler(noopSetters(), deps);
    });

    const handle = result.current;
    // A replay envelope establishes provenance (only a buffer descended from
    // THIS tab's own replay is persistable — fix-replay-cache-partial-payload-cursor).
    handle({
      type: "event_replay",
      sessionId: "s1",
      events: [{ seq: 1, event: liveEvent("s1", 1).event }],
      isLast: true,
    } as ServerToBrowserMessage);
    // Live events then accumulate into the durable buffer and persist.
    handle(liveEvent("s1", 2));
    await persister.flush("s1");
    expect(await cache.get("s1", KEY)).not.toBeNull();

    // A server-side seq reset must purge the entry → next load full-replays.
    handle({ type: "session_state_reset", sessionId: "s1" } as ServerToBrowserMessage);
    // drop() fires cache.delete; give the microtask queue a tick.
    await persister.flush("s1");
    expect(await cache.get("s1", KEY)).toBeNull();
  });
});
