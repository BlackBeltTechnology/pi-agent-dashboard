import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { createReplayCache, type CachedEvent } from "../replay/replay-cache.js";
import { createReplayPersister } from "../replay/replay-persist.js";

function evt(seq: number): CachedEvent {
  return {
    seq,
    event: { sessionId: "s", eventType: "message_end", timestamp: seq, data: {} } as unknown as DashboardEvent,
  };
}

describe("replay-persist", () => {
  let factory: IDBFactory;
  beforeEach(() => {
    factory = new IDBFactory();
  });

  it("records events and flushes the buffer to the cache with the right maxSeq", async () => {
    const cache = createReplayCache({ factory });
    const p = createReplayPersister(cache, 0);
    p.record("s1", [evt(1), evt(2)]);
    p.record("s1", [evt(3)]);
    await p.flush("s1");

    const hit = await cache.get("s1");
    expect(hit?.maxSeq).toBe(3);
    expect(hit?.payload.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("dedups events already in the buffer by seq", async () => {
    const cache = createReplayCache({ factory });
    const p = createReplayPersister(cache, 0);
    p.record("s1", [evt(1), evt(2)]);
    p.record("s1", [evt(2), evt(3)]); // seq 2 is a duplicate
    await p.flush("s1");
    expect((await cache.get("s1"))?.payload.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("seed replaces the buffer wholesale", async () => {
    const cache = createReplayCache({ factory });
    const p = createReplayPersister(cache, 0);
    p.record("s1", [evt(1), evt(2), evt(3)]);
    p.seed("s1", [evt(10)]);
    await p.flush("s1");
    expect((await cache.get("s1"))?.payload.map((e) => e.seq)).toEqual([10]);
  });

  it("prepend keeps older pages in the refold buffer but excludes them from persistence", async () => {
    const cache = createReplayCache({ factory });
    const p = createReplayPersister(cache, 0);
    // Tail establishes durable boundary at seq 10.
    p.seed("s1", [evt(10), evt(11)]);
    const full = p.prepend("s1", [evt(8), evt(9), evt(10)]);

    expect(full.map((entry) => entry.seq)).toEqual([8, 9, 10, 11]);
    expect(p.getBuffer("s1").map((entry) => entry.seq)).toEqual([8, 9, 10, 11]);
    await p.flush("s1");
    // Reload resumes from bounded tail, not every paginated older page.
    expect((await cache.get("s1"))?.payload.map((entry) => entry.seq)).toEqual([10, 11]);
  });

  it("record appends live/delta events after a tail seed without moving its boundary", async () => {
    const cache = createReplayCache({ factory });
    const p = createReplayPersister(cache, 0);
    p.seed("s1", [evt(10)]);
    p.prepend("s1", [evt(8), evt(9)]);
    p.record("s1", [evt(11), evt(12)]);
    await p.flush("s1");

    expect((await cache.get("s1"))?.payload.map((entry) => entry.seq)).toEqual([10, 11, 12]);
  });

  it("drop clears the buffer and deletes the persisted entry", async () => {
    const cache = createReplayCache({ factory });
    const p = createReplayPersister(cache, 0);
    p.record("s1", [evt(1)]);
    await p.flush("s1");
    expect(await cache.get("s1")).not.toBeNull();

    await p.drop("s1");
    // Buffer cleared: a later flush writes nothing back.
    await p.flush("s1");
    expect(await cache.get("s1")).toBeNull();
  });
});
