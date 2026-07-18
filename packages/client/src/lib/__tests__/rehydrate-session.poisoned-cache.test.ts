/**
 * Regression suite for change: fix-reducer-crash-undefined-toolname
 *
 * `rehydrateSession` re-reduces the durable IndexedDB replay cache at App
 * level — above every React error boundary. A single malformed cached
 * event that makes the reducer throw would therefore unmount the whole
 * app (black screen). The cache is an optimization only: a re-reduce
 * failure MUST degrade to a full replay (cache miss), never propagate.
 *
 * These tests assert the fault-isolation independently of the reducer's
 * own toolName tolerance: the poisoned payload uses a `tool_execution_start`
 * with `data: null`, which the reducer does not (and need not) tolerate —
 * standing in for any future malformed cached event.
 */

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

/** A cached event the reducer cannot reduce (`data: null` on a handler that
 *  dereferences `data`) — stands in for any malformed cached event that
 *  makes the re-reduce throw during rehydrate. */
function poisonedEvent(seq: number): CachedEvent {
  return {
    seq,
    event: {
      sessionId: "s",
      eventType: "tool_execution_start",
      timestamp: seq,
      data: null,
    } as unknown as DashboardEvent,
  };
}

describe("rehydrateSession — poisoned cache entry", () => {
  let factory: IDBFactory;
  beforeEach(() => {
    factory = new IDBFactory();
  });

  it("falls back to a cache miss (null) instead of throwing when a cached event re-reduces to a throw", async () => {
    const cache = createReplayCache({ factory });
    await cache.put("s1", { maxSeq: 9, payload: [userMsg(5, "hi"), poisonedEvent(9)] });

    // Must not throw; a re-reduce failure degrades to a cache miss (null) so
    // the caller performs a full replay (lastSeq: 0).
    const result = await rehydrateSession("s1", cache);
    expect(result).toBeNull();
    // The poisoned entry is discarded so it cannot re-poison a later load.
    expect(await cache.get("s1")).toBeNull();
  });

  it("still delta-rehydrates a healthy cache entry", async () => {
    const cache = createReplayCache({ factory });
    await cache.put("s2", { maxSeq: 7, payload: [userMsg(5, "hello"), userMsg(7, "world")] });

    const result = await rehydrateSession("s2", cache);
    expect(result).not.toBeNull();
    expect(result?.lastSeq).toBe(7);
    expect(result?.state.messages.length).toBeGreaterThan(0);
  });
});
