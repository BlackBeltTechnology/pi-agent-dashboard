import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { type RefreshChatDeps, refreshChat } from "../chat/refresh-chat.js";
import { type CachedEvent, createReplayCache } from "../replay/replay-cache.js";
import { createReplayPersister } from "../replay/replay-persist.js";

const KEY = "a:8000";

function evt(seq: number): CachedEvent {
  return {
    seq,
    event: { sessionId: "s", eventType: "message_end", timestamp: seq, data: {} } as unknown as DashboardEvent,
  };
}

function deps(over: Partial<RefreshChatDeps> = {}) {
  const calls: string[] = [];
  const d: RefreshChatDeps = {
    dropPersisted: vi.fn(async (id: string) => {
      calls.push(`drop:${id}`);
    }),
    resetSessionState: vi.fn((id: string) => {
      calls.push(`reset:${id}`);
    }),
    resetCursor: vi.fn((id: string) => {
      calls.push(`cursor:${id}`);
    }),
    markSubscribed: vi.fn((id: string) => {
      calls.push(`mark:${id}`);
    }),
    subscribe: vi.fn((id: string) => {
      calls.push(`subscribe:${id}`);
    }),
    beginLoadingHistory: vi.fn((id: string) => {
      calls.push(`loading:${id}`);
    }),
    beginReplayInFlight: vi.fn((id: string) => {
      calls.push(`inflight:${id}`);
    }),
    ...over,
  };
  return { d, calls };
}

describe("refreshChat", () => {
  it("performs the full in-memory reset and resubscribes at lastSeq 0 (test-plan #F2)", async () => {
    const { d } = deps();
    await refreshChat("s1", d);

    expect(d.resetSessionState).toHaveBeenCalledWith("s1");
    expect(d.resetCursor).toHaveBeenCalledWith("s1");
    expect(d.markSubscribed).toHaveBeenCalledWith("s1");
    expect(d.subscribe).toHaveBeenCalledWith("s1");
    expect(d.beginLoadingHistory).toHaveBeenCalledWith("s1");
  });

  it("arms the replay-in-flight indicator after resubscribing", async () => {
    // Refresh resubscribes at lastSeq 0, so the replay it triggers is exactly the
    // case the in-flight pill exists for. The indicator is armed by the same
    // coordinator as the resubscribe so the header and mobile call sites cannot
    // drift apart — the drift this extraction removed.
    // See change: show-replay-in-flight-indicator.
    const { d, calls } = deps();
    await refreshChat("s1", d);

    expect(d.beginReplayInFlight).toHaveBeenCalledWith("s1");
    expect(calls.indexOf("subscribe:s1")).toBeLessThan(calls.indexOf("inflight:s1"));
  });

  it("deletes the durable entry BEFORE resetting in-memory state (test-plan #F3)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { d, calls } = deps({
      dropPersisted: vi.fn(async () => {
        await gate;
        calls.push("drop:s1");
      }),
    });
    const pending = refreshChat("s1", d);

    // While the durable delete is still in flight, NOTHING may have been reset:
    // an in-memory reset paired with a surviving entry is the Frankenstein view
    // (stale base + delta tail) this ordering exists to prevent.
    await Promise.resolve();
    expect(d.resetSessionState).not.toHaveBeenCalled();
    expect(d.subscribe).not.toHaveBeenCalled();

    release();
    await pending;

    expect(calls[0]).toBe("drop:s1");
    expect(calls).toContain("reset:s1");
    expect(calls.indexOf("drop:s1")).toBeLessThan(calls.indexOf("subscribe:s1"));
  });

  it("scopes invalidation to the refreshed session (test-plan #E8)", async () => {
    const factory = new IDBFactory();
    const cache = createReplayCache({ factory });
    const persister = createReplayPersister(cache, 0, () => KEY);

    persister.seed("X", [evt(1), evt(2)]);
    persister.seed("Y", [evt(1)]);
    await persister.flush("X");
    await persister.flush("Y");
    expect(await cache.get("X", KEY)).not.toBeNull();
    expect(await cache.get("Y", KEY)).not.toBeNull();

    const { d } = deps({ dropPersisted: (id) => persister.drop(id) });
    await refreshChat("X", d);

    expect(await cache.get("X", KEY)).toBeNull();
    // The sibling entry is untouched and still delta-replays.
    expect((await cache.get("Y", KEY))?.maxSeq).toBe(1);
  });

  it("still refreshes when the durable store is unavailable (test-plan #X1)", async () => {
    // Private-browsing shape: no IndexedDB factory at all.
    const cache = createReplayCache({ factory: undefined });
    const persister = createReplayPersister(cache, 0, () => KEY);
    const { d } = deps({ dropPersisted: (id) => persister.drop(id) });

    await expect(refreshChat("s1", d)).resolves.toBeUndefined();

    // Refresh is not gated on the cache layer: the user's escape hatch must work
    // in exactly the environments where the cache cannot cause the problem.
    expect(d.resetSessionState).toHaveBeenCalledWith("s1");
    expect(d.subscribe).toHaveBeenCalledWith("s1");
    expect(d.beginLoadingHistory).toHaveBeenCalledWith("s1");
  });

  it("still refreshes when the durable delete rejects outright (test-plan #X3)", async () => {
    const { d } = deps({
      dropPersisted: vi.fn(async () => {
        throw new Error("IDB transaction aborted");
      }),
    });

    await expect(refreshChat("s1", d)).resolves.toBeUndefined();

    // A failed invalidation must not swallow the refresh itself. The stale entry
    // surviving to the NEXT page load is the accepted residual (design D6) — but
    // the current page must still reset and full-replay.
    expect(d.resetSessionState).toHaveBeenCalledWith("s1");
    expect(d.subscribe).toHaveBeenCalledWith("s1");
  });
});
