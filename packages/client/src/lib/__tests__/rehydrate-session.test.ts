import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { createReplayCache, type CachedEvent } from "../replay/replay-cache.js";
import { rehydrateSession } from "../replay/rehydrate-session.js";

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

describe("rehydrateSession", () => {
  let factory: IDBFactory;
  beforeEach(() => {
    factory = new IDBFactory();
  });

  it("returns lastSeq = persistedMaxSeq and re-reduces state from the cached events", async () => {
    const cache = createReplayCache({ factory });
    await cache.put("s1", { maxSeq: 7, payload: [userMsg(5, "hello"), userMsg(7, "world")] });

    const result = await rehydrateSession("s1", cache);
    expect(result).not.toBeNull();
    expect(result?.lastSeq).toBe(7);
    expect(result?.events.map((e) => e.seq)).toEqual([5, 7]);
    // Re-reduced state carries the cached user messages (not an empty chat).
    expect(result?.state.messages.length).toBeGreaterThan(0);
  });

  it("returns null when the session has no cache entry", async () => {
    const cache = createReplayCache({ factory });
    expect(await rehydrateSession("missing", cache)).toBeNull();
  });
});
