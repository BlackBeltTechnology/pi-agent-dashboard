import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CachedEvent, createReplayCache, type ReplayCache } from "../replay/replay-cache.js";
import { createReplayPersister } from "../replay/replay-persist.js";

function evt(seq: number): CachedEvent {
  return {
    seq,
    event: { sessionId: "s", eventType: "message_end", timestamp: seq, data: {} } as unknown as DashboardEvent,
  };
}

/** Spy wrapper so provenance tests can assert on put/delete CALLS, not just
 *  the resulting store state (D2: a skip must never issue a delete). */
function spyCache(inner: ReplayCache) {
  const put = vi.fn(inner.put);
  const del = vi.fn(inner.delete);
  const cache: ReplayCache = { get: inner.get, put, delete: del };
  return { cache, put, del };
}

describe("replay-persist", () => {
  let factory: IDBFactory;
  beforeEach(() => {
    factory = new IDBFactory();
  });

  it("records events and flushes the buffer to the cache with the right maxSeq", async () => {
    const cache = createReplayCache({ factory });
    const p = createReplayPersister(cache, 0);
    p.record("s1", [evt(1), evt(2)], "replay");
    p.record("s1", [evt(3)], "live");
    await p.flush("s1");

    const hit = await cache.get("s1");
    expect(hit?.maxSeq).toBe(3);
    expect(hit?.payload.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("dedups events already in the buffer by seq", async () => {
    const cache = createReplayCache({ factory });
    const p = createReplayPersister(cache, 0);
    p.record("s1", [evt(1), evt(2)], "replay");
    p.record("s1", [evt(2), evt(3)], "replay"); // seq 2 is a duplicate
    await p.flush("s1");
    expect((await cache.get("s1"))?.payload.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("seed replaces the buffer wholesale", async () => {
    const cache = createReplayCache({ factory });
    const p = createReplayPersister(cache, 0);
    p.record("s1", [evt(1), evt(2), evt(3)], "replay");
    p.seed("s1", [evt(10)]);
    await p.flush("s1");
    expect((await cache.get("s1"))?.payload.map((e) => e.seq)).toEqual([10]);
  });

  it("drop clears the buffer and deletes the persisted entry", async () => {
    const cache = createReplayCache({ factory });
    const p = createReplayPersister(cache, 0);
    p.record("s1", [evt(1)], "replay");
    await p.flush("s1");
    expect(await cache.get("s1")).not.toBeNull();

    await p.drop("s1");
    // Buffer cleared: a later flush writes nothing back.
    await p.flush("s1");
    expect(await cache.get("s1")).toBeNull();
  });

  // --- Provenance (change: fix-replay-cache-partial-payload-cursor) ---

  it("never persists a broadcast-only buffer (test-plan #E1)", async () => {
    const { cache, put } = spyCache(createReplayCache({ factory }));
    const p = createReplayPersister(cache, 0);
    p.record("X", [evt(250)], "live");
    await p.flush("X");

    expect(put).not.toHaveBeenCalled();
    expect(await cache.get("X")).toBeNull();
  });

  it("persists a seeded buffer (test-plan #E2)", async () => {
    const { cache, put } = spyCache(createReplayCache({ factory }));
    const p = createReplayPersister(cache, 0);
    p.seed("X", [evt(1), evt(2), evt(3)]);
    await p.flush("X");

    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]?.[1]).toMatchObject({ maxSeq: 3 });
    expect(put.mock.calls[0]?.[1].payload).toHaveLength(3);
  });

  it("persists a cold replay that starts past seq 1 (test-plan #E3)", async () => {
    const { cache, put } = spyCache(createReplayCache({ factory }));
    const p = createReplayPersister(cache, 0);
    p.record("X", [evt(5), evt(6)], "replay");
    await p.flush("X");

    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]?.[1]).toMatchObject({ maxSeq: 6 });
  });

  it("keeps live appends onto a descended buffer persistable (test-plan #E4)", async () => {
    const { cache, put } = spyCache(createReplayCache({ factory }));
    const p = createReplayPersister(cache, 0);
    p.record("X", [evt(5), evt(6)], "replay");
    await p.flush("X");
    put.mockClear();

    p.record("X", [evt(7)], "live");
    await p.flush("X");
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]?.[1]).toMatchObject({ maxSeq: 7 });
  });

  it("treats the just-contiguous live boundary as no gap (test-plan #E5)", async () => {
    const { cache, put } = spyCache(createReplayCache({ factory }));
    const p = createReplayPersister(cache, 0);
    p.seed("X", [evt(9), evt(10)]);
    await p.flush("X");
    put.mockClear();

    p.record("X", [evt(11)], "live");
    await p.flush("X");
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]?.[1]).toMatchObject({ maxSeq: 11 });
  });

  it("voids the cursor when a live frame is lost (test-plan #E6)", async () => {
    const { cache, put, del } = spyCache(createReplayCache({ factory }));
    const p = createReplayPersister(cache, 0);
    p.seed("X", [evt(9), evt(10)]);
    await p.flush("X");
    put.mockClear();

    p.record("X", [evt(12)], "live"); // 11 never arrived
    await p.flush("X");
    expect(put).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("restores provenance when a voided buffer is re-seeded (test-plan #E7)", async () => {
    const { cache, put } = spyCache(createReplayCache({ factory }));
    const p = createReplayPersister(cache, 0);
    p.seed("X", [evt(9), evt(10)]);
    await p.flush("X");
    p.record("X", [evt(12)], "live"); // voids provenance
    await p.flush("X");
    put.mockClear();

    p.seed("X", [evt(1), evt(2), evt(3)]);
    await p.flush("X");
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("tolerates gaps on the replay path (compaction) (test-plan #E8)", async () => {
    const { cache, put } = spyCache(createReplayCache({ factory }));
    const p = createReplayPersister(cache, 0);
    p.record("X", [evt(3), evt(7), evt(9)], "replay");
    await p.flush("X");

    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]?.[1]).toMatchObject({ maxSeq: 9 });
  });

  it("does not destroy a sibling tab's entry from a broadcast observer (test-plan #X1)", async () => {
    const inner = createReplayCache({ factory });
    // Tab 1: a legitimately descended entry.
    const p1 = createReplayPersister(inner, 0);
    p1.seed("X", [evt(199), evt(200)]);
    await p1.flush("X");
    expect((await inner.get("X"))?.maxSeq).toBe(200);

    // Tab 2: only ever saw a broadcast for X.
    const { cache, del } = spyCache(inner);
    const p2 = createReplayPersister(cache, 0);
    p2.record("X", [evt(500)], "live");
    await p2.flush("X");

    expect(del).not.toHaveBeenCalled();
    expect((await inner.get("X"))?.maxSeq).toBe(200);
  });

  it("stays silent on non-descended flushes (test-plan #X2)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const cache = createReplayCache({ factory });
      const p = createReplayPersister(cache, 0);
      for (const id of ["a", "b", "c", "d", "e"]) p.record(id, [evt(42)], "live");
      await Promise.all(["a", "b", "c", "d", "e"].map((id) => p.flush(id)));

      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
