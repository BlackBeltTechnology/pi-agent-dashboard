import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type CachedEvent,
  createReplayCache,
  deriveServerKey,
  REPLAY_CACHE_SCHEMA_VERSION,
} from "../replay/replay-cache.js";

function evt(seq: number): CachedEvent {
  return {
    seq,
    event: { sessionId: "s", eventType: "message_end", timestamp: seq, data: {} } as unknown as DashboardEvent,
  };
}

/**
 * Write a GENUINE pre-v3 entry: `schemaVersion: 2` and NO `serverKey` field.
 *
 * `put()` cannot produce this — it stamps `serverKey` unconditionally, whatever
 * `schemaVersion` the cache was constructed with. A fixture built with a
 * "v2-shaped writer" therefore still carries a matching key, and a hypothetical
 * key-first `get()` would pass the key check and fall through to the schema
 * branch anyway, so the ordering the test names would go unpinned.
 * See change: purge-replay-cache-on-reset-paths.
 */
function openRawDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open("pi-dashboard-replay-cache", 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("sessions")) {
        d.createObjectStore("sessions", { keyPath: "sessionId" });
      }
    };
    req.onsuccess = () => { resolve(req.result); };
    req.onerror = () => { reject(req.error); };
  });
}

async function putPreV3Entry(factory: IDBFactory, sessionId: string): Promise<void> {
  const db = await openRawDb(factory);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("sessions", "readwrite");
    // Deliberately omits `serverKey` — exactly what a v2 writer left behind.
    tx.objectStore("sessions").put({
      sessionId,
      schemaVersion: 2,
      maxSeq: 9,
      payload: [evt(9)],
      lastAccess: 1,
    });
    tx.oncomplete = () => { resolve(); };
    tx.onerror = () => { reject(tx.error); };
  });
  db.close();
}

/**
 * Read a record STRAIGHT out of the object store, bypassing `get()`.
 *
 * Deletion of a pre-v3 entry is invisible through `get()`: the entry has no
 * `serverKey`, so any reader misses it whether or not it was purged. Only a raw
 * read distinguishes "deleted" from "still there but missed".
 * See change: purge-replay-cache-on-reset-paths.
 */
async function readRawEntry(factory: IDBFactory, sessionId: string): Promise<unknown> {
  const db = await openRawDb(factory);
  const record = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction("sessions", "readonly");
    const req = tx.objectStore("sessions").get(sessionId);
    req.onsuccess = () => { resolve(req.result); };
    req.onerror = () => { reject(req.error); };
  });
  db.close();
  return record;
}

/** Default server key for tests that don't exercise attribution. */
const A = "a:8000";
const B = "b:8000";

describe("replay-cache", () => {
  let factory: IDBFactory;

  beforeEach(() => {
    // Fresh in-memory IndexedDB per test for isolation.
    factory = new IDBFactory();
  });

  it("round-trips put → get for a session", async () => {
    const cache = createReplayCache({ factory });
    await cache.put("sess-a", { maxSeq: 3, payload: [evt(1), evt(2), evt(3)] }, A);
    const hit = await cache.get("sess-a", A);
    expect(hit).not.toBeNull();
    expect(hit?.maxSeq).toBe(3);
    expect(hit?.payload.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(hit?.schemaVersion).toBe(REPLAY_CACHE_SCHEMA_VERSION);
  });

  it("returns null for an unknown session", async () => {
    const cache = createReplayCache({ factory });
    expect(await cache.get("nope", A)).toBeNull();
  });

  it("delete removes the entry", async () => {
    const cache = createReplayCache({ factory });
    await cache.put("sess-a", { maxSeq: 1, payload: [evt(1)] }, A);
    await cache.delete("sess-a");
    expect(await cache.get("sess-a", A)).toBeNull();
  });

  it("treats a schemaVersion mismatch as a miss and drops the entry", async () => {
    // Writer uses an OLD schema version; reader runs the current version.
    const writer = createReplayCache({ factory, schemaVersion: REPLAY_CACHE_SCHEMA_VERSION - 1 });
    await writer.put("sess-a", { maxSeq: 2, payload: [evt(1), evt(2)] }, A);

    const reader = createReplayCache({ factory });
    expect(await reader.get("sess-a", A)).toBeNull();
    // Entry purged: even a stale-version reader now misses.
    expect(await writer.get("sess-a", A)).toBeNull();
  });

  it("skips persisting a session whose payload exceeds the per-session byte cap", async () => {
    const cache = createReplayCache({ factory, maxBytesPerSession: 200 });
    const big = Array.from({ length: 50 }, (_, i) => evt(i + 1));
    await cache.put("huge", { maxSeq: 50, payload: big }, A);
    // Over-cap payload is not persisted → next load full-replays.
    expect(await cache.get("huge", A)).toBeNull();
  });

  // --- Schema bump (change: fix-replay-cache-partial-payload-cursor) ---

  it("purges a pre-change (schemaVersion 1) partial-payload entry (test-plan #E9)", async () => {
    expect(REPLAY_CACHE_SCHEMA_VERSION).toBeGreaterThanOrEqual(2);
    const v1 = createReplayCache({ factory, schemaVersion: 1 });
    // The field-poisoned shape: a high cursor over a single stray broadcast row.
    await v1.put("X", { maxSeq: 250, payload: [evt(250)] }, A);

    const current = createReplayCache({ factory });
    expect(await current.get("X", A)).toBeNull();
    // Purged, not merely skipped: even a v1 reader now misses.
    expect(await v1.get("X", A)).toBeNull();
  });

  it("purges once on the schema bump, then caches normally (test-plan #P1)", async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `s${i}`);
    const v1 = createReplayCache({ factory, schemaVersion: 1 });
    for (const id of ids) await v1.put(id, { maxSeq: 100, payload: [evt(100)] }, A);

    const current = createReplayCache({ factory, maxEntries: 100 });
    // One load cycle at the current version: every entry misses exactly once.
    for (const id of ids) expect(await current.get(id, A)).toBeNull();

    // Normal caching resumes — no purge loop on the re-written entries.
    for (const id of ids) await current.put(id, { maxSeq: 5, payload: [evt(5)] }, A);
    for (const id of ids) expect((await current.get(id, A))?.maxSeq).toBe(5);
  });

  it("evicts the least-recently-accessed entry past the cap", async () => {
    const cache = createReplayCache({ factory, maxEntries: 2 });
    await cache.put("a", { maxSeq: 1, payload: [evt(1)] }, A);
    await cache.put("b", { maxSeq: 1, payload: [evt(1)] }, A);
    // Touch "a" so "b" becomes least-recently-accessed.
    await cache.get("a", A);
    await cache.put("c", { maxSeq: 1, payload: [evt(1)] }, A);

    expect(await cache.get("a", A)).not.toBeNull();
    expect(await cache.get("c", A)).not.toBeNull();
    expect(await cache.get("b", A)).toBeNull();
  });

  // --- Server-scoped entries (change: purge-replay-cache-on-reset-paths) ---

  it("serves an entry to the server that wrote it (test-plan #E1)", async () => {
    const cache = createReplayCache({ factory });
    await cache.put("s1", { maxSeq: 3, payload: [evt(3)] }, A);

    const hit = await cache.get("s1", A);
    expect(hit).not.toBeNull();
    expect(hit?.serverKey).toBe(A);
    expect(hit?.maxSeq).toBe(3);
  });

  it("treats a serverKey mismatch as a miss WITHOUT deleting the entry (test-plan #E2)", async () => {
    const cache = createReplayCache({ factory });
    await cache.put("s1", { maxSeq: 3, payload: [evt(3)] }, A);

    // Foreign read misses...
    expect(await cache.get("s1", B)).toBeNull();
    // ...and MUST NOT destroy it: the owning server still gets its entry back.
    // (Unlike a schema mismatch, a foreign entry is valuable to its own server.)
    const stillThere = await cache.get("s1", A);
    expect(stillThere).not.toBeNull();
    expect(stillThere?.maxSeq).toBe(3);
  });

  it("purges an entry that predates server scoping (test-plan #E3)", async () => {
    // A REAL pre-v3 entry: schemaVersion 2 and NO serverKey field.
    await putPreV3Entry(factory, "s1");

    const current = createReplayCache({ factory });
    expect(await current.get("s1", A)).toBeNull();
    // Deleted, not merely missed — proves the schema check runs BEFORE the key
    // check. Key-first ordering would see `serverKey: undefined !== A`, decline
    // to delete (E2 rule), and strand an unattributable zombie entry forever.
    // Read RAW: with no serverKey on the entry, `get()` misses under either
    // ordering, so only a direct store read can tell purged from merely missed.
    expect(await readRawEntry(factory, "s1")).toBeUndefined();
  });

  it("does not refresh LRU age on a serverKey mismatch (test-plan #E6)", async () => {
    const cache = createReplayCache({ factory, maxEntries: 2 });
    // "foreign" belongs to server A; the others to server B.
    await cache.put("foreign", { maxSeq: 1, payload: [evt(1)] }, A);
    await cache.put("live", { maxSeq: 1, payload: [evt(1)] }, B);

    // A mismatching read must NOT bump lastAccess, or a server the user never
    // returns to would hold LRU slots indefinitely.
    expect(await cache.get("foreign", B)).toBeNull();

    // Push past the cap → the untouched foreign entry evicts first.
    await cache.put("fresh", { maxSeq: 1, payload: [evt(1)] }, B);
    expect(await cache.get("foreign", A)).toBeNull();
    expect(await cache.get("live", B)).not.toBeNull();
    expect(await cache.get("fresh", B)).not.toBeNull();
  });

  it("over-cap put still deletes a foreign entry for the same id (test-plan #E7)", async () => {
    const cache = createReplayCache({ factory, maxBytesPerSession: 200 });
    await cache.put("s1", { maxSeq: 1, payload: [evt(1)] }, A);

    // Over-cap write from a DIFFERENT server: the unkeyed delete must still fire,
    // otherwise the over-cap branch silently leaves a stale entry behind.
    const big = Array.from({ length: 50 }, (_, i) => evt(i + 1));
    await cache.put("s1", { maxSeq: 50, payload: big }, B);

    expect(await cache.get("s1", A)).toBeNull();
    expect(await cache.get("s1", B)).toBeNull();
  });

  it("migrates a store full of v2 entries without crashing (test-plan #X4)", async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `s${i}`);
    const v2 = createReplayCache({ factory, schemaVersion: 2 });
    for (const id of ids) await v2.put(id, { maxSeq: 40, payload: [evt(40)] }, A);

    const current = createReplayCache({ factory, maxEntries: 100 });
    for (const id of ids) expect(await current.get(id, A)).toBeNull();

    // Normal server-scoped caching resumes afterwards.
    for (const id of ids) await current.put(id, { maxSeq: 2, payload: [evt(2)] }, A);
    for (const id of ids) expect((await current.get(id, A))?.maxSeq).toBe(2);
  });
});

describe("deriveServerKey", () => {
  it("normalizes an omitted default port (test-plan #E4)", () => {
    // The SAME live connection must never be attributed two ways, or every hit
    // breaks spuriously.
    expect(deriveServerKey("ws://box/ws")).toBe("box:80");
    expect(deriveServerKey("ws://box:80/ws")).toBe("box:80");
    expect(deriveServerKey("ws://box/ws")).toBe(deriveServerKey("ws://box:80/ws"));
  });

  it("derives host:port across schemes and explicit ports (test-plan #E5)", () => {
    expect(deriveServerKey("wss://box/ws")).toBe("box:443");
    expect(deriveServerKey("wss://box:443/ws")).toBe("box:443");
    expect(deriveServerKey("ws://box:8000/ws")).toBe("box:8000");
  });

  it("keeps distinct servers on distinct keys", () => {
    expect(deriveServerKey("ws://a:8000/ws")).not.toBe(deriveServerKey("ws://b:8000/ws"));
    expect(deriveServerKey("ws://a:8000/ws")).not.toBe(deriveServerKey("ws://a:9000/ws"));
  });
});
