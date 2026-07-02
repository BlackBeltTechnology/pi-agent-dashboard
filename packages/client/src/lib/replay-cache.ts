/**
 * Durable per-session replay cache (Strategy A).
 *
 * Persists the raw replayed event tail + cursor for each session to IndexedDB
 * so a page reload can resubscribe with `lastSeq = maxSeq` (delta replay)
 * instead of `lastSeq: 0` (full replay). The cache is an OPTIMIZATION ONLY:
 * any miss, schemaVersion mismatch, eviction, or IndexedDB error degrades to a
 * full replay with no error surfaced to the user.
 *
 * Decision (design.md 1.1): persist RAW events (`{ seq, event }[]`), not reduced
 * `ChatMessage[]`. The reducer is pure, so re-reducing on load is cheap and the
 * cache binds only to the stable event wire schema — keeping `schemaVersion`
 * bumps rare.
 *
 * See change: reduce-session-replay-traffic.
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/** Bump on any persisted-shape change → all entries invalidate (full replay). */
export const REPLAY_CACHE_SCHEMA_VERSION = 1;

const DB_NAME = "pi-dashboard-replay-cache";
const STORE = "sessions";
const DEFAULT_MAX_ENTRIES = 50;
/** Per-session payload byte cap (~5 MB). Over-cap → skip persist, full replay. */
const DEFAULT_MAX_BYTES_PER_SESSION = 5 * 1024 * 1024;

export interface CachedEvent {
  seq: number;
  event: DashboardEvent;
}

export interface ReplayCacheEntry {
  sessionId: string;
  schemaVersion: number;
  maxSeq: number;
  payload: CachedEvent[];
  lastAccess: number;
}

export interface ReplayCachePut {
  maxSeq: number;
  payload: CachedEvent[];
}

export interface ReplayCacheOptions {
  /** Injectable IndexedDB factory (tests pass a fresh `new IDBFactory()`). */
  factory?: IDBFactory;
  /** Max retained sessions before LRU eviction by `lastAccess`. */
  maxEntries?: number;
  /** Per-session serialized-payload byte cap; over-cap sessions are not persisted. */
  maxBytesPerSession?: number;
  /** Override the schema version (tests simulate drift). */
  schemaVersion?: number;
}

export interface ReplayCache {
  get(sessionId: string): Promise<ReplayCacheEntry | null>;
  put(sessionId: string, value: ReplayCachePut): Promise<void>;
  delete(sessionId: string): Promise<void>;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}

export function createReplayCache(opts: ReplayCacheOptions = {}): ReplayCache {
  const factory = opts.factory ?? (typeof indexedDB !== "undefined" ? indexedDB : undefined);
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxBytesPerSession = opts.maxBytesPerSession ?? DEFAULT_MAX_BYTES_PER_SESSION;
  const schemaVersion = opts.schemaVersion ?? REPLAY_CACHE_SCHEMA_VERSION;

  let dbPromise: Promise<IDBDatabase> | null = null;

  // Monotonic access stamp for LRU ordering. Wall-clock `Date.now()` TIES under
  // fast execution (multiple put/get in the same millisecond), making eviction
  // order non-deterministic. Track the last issued value and bump by 1 on a tie
  // so ordering is strictly increasing within the instance while staying ~wall-
  // clock (a fresh session's Date.now() dominates any persisted prior stamp).
  let lastStamp = 0;
  function nextStamp(): number {
    const now = Date.now();
    lastStamp = now > lastStamp ? now : lastStamp + 1;
    return lastStamp;
  }

  function openDb(): Promise<IDBDatabase> {
    if (!factory) return Promise.reject(new Error("IndexedDB unavailable"));
    if (!dbPromise) {
      dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const req = factory.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE, { keyPath: "sessionId" });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }).catch((err) => {
        dbPromise = null;
        throw err;
      });
    }
    return dbPromise;
  }

  async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  }

  async function get(sessionId: string): Promise<ReplayCacheEntry | null> {
    return safe(async () => {
      const db = await openDb();
      const tx = db.transaction(STORE, "readonly");
      const entry = (await promisify(tx.objectStore(STORE).get(sessionId))) as
        | ReplayCacheEntry
        | undefined;
      await txDone(tx).catch(() => {});
      if (!entry) return null;
      // Schema drift → drop the entry and miss.
      if (entry.schemaVersion !== schemaVersion) {
        await del(sessionId);
        return null;
      }
      // Touch last-access for LRU ordering.
      await touch(sessionId);
      return entry;
    }, null);
  }

  // Read-modify-write the lastAccess stamp in ONE transaction so a concurrent
  // put()/flush that landed between get()'s read and this write is not rolled
  // back to a stale payload/maxSeq snapshot. Only bumps lastAccess; never
  // resurrects a deleted entry.
  async function touch(sessionId: string): Promise<void> {
    await safe(async () => {
      const db = await openDb();
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const current = (await promisify(store.get(sessionId))) as ReplayCacheEntry | undefined;
      if (current) store.put({ ...current, lastAccess: nextStamp() });
      await txDone(tx);
    }, undefined);
  }

  async function put(sessionId: string, value: ReplayCachePut): Promise<void> {
    await safe(async () => {
      // Over-cap payload: skip persist and drop any stale entry → full replay.
      if (JSON.stringify(value.payload).length > maxBytesPerSession) {
        await del(sessionId);
        return;
      }
      const db = await openDb();
      const entry: ReplayCacheEntry = {
        sessionId,
        schemaVersion,
        maxSeq: value.maxSeq,
        payload: value.payload,
        lastAccess: nextStamp(),
      };
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(entry);
      await txDone(tx);
      await evictIfNeeded();
    }, undefined);
  }

  async function del(sessionId: string): Promise<void> {
    await safe(async () => {
      const db = await openDb();
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(sessionId);
      await txDone(tx);
    }, undefined);
  }

  async function evictIfNeeded(): Promise<void> {
    await safe(async () => {
      const db = await openDb();
      const tx = db.transaction(STORE, "readonly");
      const all = (await promisify(tx.objectStore(STORE).getAll())) as ReplayCacheEntry[];
      await txDone(tx).catch(() => {});
      if (all.length <= maxEntries) return;
      // Evict least-recently-accessed first.
      all.sort((a, b) => a.lastAccess - b.lastAccess);
      const toEvict = all.slice(0, all.length - maxEntries);
      for (const e of toEvict) await del(e.sessionId);
    }, undefined);
  }

  return { get, put, delete: del };
}

/** App-wide singleton backed by the browser's IndexedDB. */
export const replayCache: ReplayCache = createReplayCache();
