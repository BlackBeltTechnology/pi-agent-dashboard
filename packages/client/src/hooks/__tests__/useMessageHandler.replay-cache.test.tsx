import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRef } from "react";
import { IDBFactory } from "fake-indexeddb";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { createReplayCache, type CachedEvent } from "../../lib/replay/replay-cache.js";
import { createReplayPersister } from "../../lib/replay/replay-persist.js";
import { useMessageHandler, type MessageHandlerSetters } from "../useMessageHandler.js";

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

describe("useMessageHandler — Strategy A replay-cache invalidation", () => {
  let factory: IDBFactory;
  beforeEach(() => {
    factory = new IDBFactory();
  });

  it("session_state_reset purges the persisted cache entry", async () => {
    const cache = createReplayCache({ factory });
    const persister = createReplayPersister(cache, 0);

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
        replayPersister: persister,
      };
      return useMessageHandler(noopSetters(), deps);
    });

    const handle = result.current;
    // Live event accumulates into the durable buffer and persists.
    handle(liveEvent("s1", 1));
    handle(liveEvent("s1", 2));
    await persister.flush("s1");
    expect(await cache.get("s1")).not.toBeNull();

    // A server-side seq reset must purge the entry → next load full-replays.
    handle({ type: "session_state_reset", sessionId: "s1" } as ServerToBrowserMessage);
    // drop() fires cache.delete; give the microtask queue a tick.
    await persister.flush("s1");
    expect(await cache.get("s1")).toBeNull();
  });
});
