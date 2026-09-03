import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { rehydrateSession } from "../replay/rehydrate-session.js";
import { type CachedEvent, createReplayCache } from "../replay/replay-cache.js";

function userMsg(seq: number, text: string): CachedEvent {
  return {
    seq,
    event: {
      sessionId: "s",
      eventType: "message_start",
      timestamp: seq,
      data: { message: { role: "user", content: text } },
    } as unknown as DashboardEvent,
  };
}

const KEY = "a:8000";

describe("rehydrateSession", () => {
  let factory: IDBFactory;
  beforeEach(() => {
    factory = new IDBFactory();
  });

  it("returns lastSeq = persistedMaxSeq and re-reduces state from the cached events", async () => {
    const cache = createReplayCache({ factory });
    await cache.put("s1", { maxSeq: 7, payload: [userMsg(5, "hello"), userMsg(7, "world")] }, KEY);

    const result = await rehydrateSession("s1", cache, KEY);
    expect(result).not.toBeNull();
    expect(result?.lastSeq).toBe(7);
    expect(result?.events.map((e) => e.seq)).toEqual([5, 7]);
    // Re-reduced state carries the cached user messages (not an empty chat).
    expect(result?.state.messages.length).toBeGreaterThan(0);
  });

  it("returns null when the session has no cache entry", async () => {
    const cache = createReplayCache({ factory });
    expect(await rehydrateSession("missing", cache, KEY)).toBeNull();
  });

  // --- Server-scoped entries (change: purge-replay-cache-on-reset-paths) ---

  it("does not serve an entry written by a different server (test-plan #F6)", async () => {
    const cache = createReplayCache({ factory });
    await cache.put("s1", { maxSeq: 7, payload: [userMsg(5, "server A only")] }, "a:8000");

    // Same session id on a DIFFERENT server: the entry must not be rehydrated,
    // so the caller degrades to a full replay (lastSeq: 0).
    expect(await rehydrateSession("s1", cache, "b:8000")).toBeNull();
  });

  it("still delta-replays after switching back to the original server (test-plan #F5)", async () => {
    const cache = createReplayCache({ factory });
    await cache.put("s1", { maxSeq: 7, payload: [userMsg(5, "hi"), userMsg(7, "there")] }, "a:8000");

    // Away on server B: miss, and the entry is NOT destroyed by the miss.
    expect(await rehydrateSession("s1", cache, "b:8000")).toBeNull();

    // Back on server A: the entry is still there and still delta-replays.
    const back = await rehydrateSession("s1", cache, "a:8000");
    expect(back).not.toBeNull();
    expect(back?.lastSeq).toBe(7);
    expect(back?.events.map((e) => e.seq)).toEqual([5, 7]);
  });
});
