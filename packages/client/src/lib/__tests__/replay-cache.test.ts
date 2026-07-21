import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import {
  createReplayCache,
  REPLAY_CACHE_SCHEMA_VERSION,
  type CachedEvent,
} from "../replay/replay-cache.js";

function evt(seq: number): CachedEvent {
  return {
    seq,
    event: { sessionId: "s", eventType: "message_end", timestamp: seq, data: {} } as unknown as DashboardEvent,
  };
}

describe("replay-cache", () => {
  let factory: IDBFactory;

  beforeEach(() => {
    // Fresh in-memory IndexedDB per test for isolation.
    factory = new IDBFactory();
  });

  it("round-trips put → get for a session", async () => {
    const cache = createReplayCache({ factory });
    await cache.put("sess-a", { maxSeq: 3, payload: [evt(1), evt(2), evt(3)] });
    const hit = await cache.get("sess-a");
    expect(hit).not.toBeNull();
    expect(hit?.maxSeq).toBe(3);
    expect(hit?.payload.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(hit?.schemaVersion).toBe(REPLAY_CACHE_SCHEMA_VERSION);
  });

  it("returns null for an unknown session", async () => {
    const cache = createReplayCache({ factory });
    expect(await cache.get("nope")).toBeNull();
  });

  it("delete removes the entry", async () => {
    const cache = createReplayCache({ factory });
    await cache.put("sess-a", { maxSeq: 1, payload: [evt(1)] });
    await cache.delete("sess-a");
    expect(await cache.get("sess-a")).toBeNull();
  });

  it("treats a schemaVersion mismatch as a miss and drops the entry", async () => {
    // Writer uses an OLD schema version; reader runs the current version.
    const writer = createReplayCache({ factory, schemaVersion: REPLAY_CACHE_SCHEMA_VERSION - 1 });
    await writer.put("sess-a", { maxSeq: 2, payload: [evt(1), evt(2)] });

    const reader = createReplayCache({ factory });
    expect(await reader.get("sess-a")).toBeNull();
    // Entry purged: even a stale-version reader now misses.
    expect(await writer.get("sess-a")).toBeNull();
  });

  it("skips persisting a session whose payload exceeds the per-session byte cap", async () => {
    const cache = createReplayCache({ factory, maxBytesPerSession: 200 });
    const big = Array.from({ length: 50 }, (_, i) => evt(i + 1));
    await cache.put("huge", { maxSeq: 50, payload: big });
    // Over-cap payload is not persisted → next load full-replays.
    expect(await cache.get("huge")).toBeNull();
  });

  it("evicts the least-recently-accessed entry past the cap", async () => {
    const cache = createReplayCache({ factory, maxEntries: 2 });
    await cache.put("a", { maxSeq: 1, payload: [evt(1)] });
    await cache.put("b", { maxSeq: 1, payload: [evt(1)] });
    // Touch "a" so "b" becomes least-recently-accessed.
    await cache.get("a");
    await cache.put("c", { maxSeq: 1, payload: [evt(1)] });

    expect(await cache.get("a")).not.toBeNull();
    expect(await cache.get("c")).not.toBeNull();
    expect(await cache.get("b")).toBeNull();
  });
});
