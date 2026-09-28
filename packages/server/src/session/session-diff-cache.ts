/**
 * Session-diff result cache + single-flight coordinator.
 *
 * `/api/session-diff` is polled repeatedly (multiple browser tabs / reconnects
 * re-request the same session's diff). Without coordination each poll launches
 * its own git work. This cache:
 *   - returns a stored result for a short TTL when the diff would be unchanged
 *     (key derives from HEAD sha + working-tree dirty signature), and
 *   - coalesces concurrent requests for the same key onto ONE in-flight
 *     computation (single-flight) instead of each spawning a diff.
 *
 * A HEAD sha or dirty-signature change yields a different key → the next
 * request recomputes (stale entries are never served). See change:
 * fix-session-diff-eventloop-block.
 */

interface CacheEntry<T> {
  value: T;
  /** epoch ms after which the entry is stale. */
  expires: number;
  /** `sizeOf(value)` at store time (0 without a byte budget). */
  bytes: number;
}

/**
 * Optional byte budget. `sizeOf` is required whenever `maxBytes` is set; with
 * neither, the cache is count-capped only (legacy behaviour).
 */
export type SessionDiffCacheOptions<T> = { maxBytes: number; sizeOf: (value: T) => number };

/** Small non-crypto string hash (djb2) for the dirty-signature key component. */
export function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  // Unsigned hex keeps the key compact and collision-resistant enough for a
  // per-session, short-TTL cache key (not a security boundary).
  return (hash >>> 0).toString(16);
}

export class SessionDiffCache<T> {
  private readonly results = new Map<string, CacheEntry<T>>();
  private readonly inflight = new Map<string, Promise<T>>();
  private bytes = 0;

  constructor(
    /** Result freshness window (ms). TTL 0 disables result caching. */
    private readonly ttlMs = 2000,
    /** Hard cap on cached entries; oldest/expired evicted past it. */
    private readonly maxEntries = 100,
    /**
     * Byte budget shared by all entries. Oldest evicted first; the newest
     * entry is always kept, so retention ≤ max(maxBytes, newest). See change:
     * fix-session-diff-heap-retention (D2).
     */
    private readonly budget?: SessionDiffCacheOptions<T>,
  ) {}

  /** Number of cached results (read-only observable). */
  get size(): number {
    return this.results.size;
  }

  /** Sum of `sizeOf` over cached results (0 without a byte budget). */
  get totalBytes(): number {
    return this.bytes;
  }

  /**
   * Return a fresh cached result for `key`, else coalesce onto the in-flight
   * computation for `key`, else run `compute()` once, store, and return it.
   * Expired entries are released on every access (D4).
   */
  async run(key: string, compute: () => Promise<T>): Promise<T> {
    const now = Date.now();
    this.sweepExpired(now);
    const hit = this.results.get(key);
    if (hit) return hit.value;

    const flight = this.inflight.get(key);
    if (flight) return flight;

    const p = (async () => {
      try {
        const value = await compute();
        this.store(key, value);
        return value;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p;
  }

  /** The ONLY removal path — keeps `bytes` accounting exact. */
  private remove(key: string): void {
    const e = this.results.get(key);
    if (!e) return;
    this.bytes -= e.bytes;
    this.results.delete(key);
  }

  private sweepExpired(now: number): void {
    for (const [k, e] of this.results) {
      if (e.expires <= now) this.remove(k);
    }
  }

  private store(key: string, value: T): void {
    if (this.ttlMs <= 0) return;
    const now = Date.now();
    const bytes = this.budget ? this.budget.sizeOf(value) : 0;
    // Overwrite → remove first so the entry moves to newest and bytes stay exact.
    this.remove(key);
    this.results.set(key, { value, expires: now + this.ttlMs, bytes });
    this.bytes += bytes;
    this.sweepExpired(now);
    const maxBytes = this.budget?.maxBytes ?? Number.POSITIVE_INFINITY;
    // Evict oldest (insertion order) while over either cap — never the entry
    // just inserted (a single large session still caches).
    while (this.results.size > this.maxEntries || this.bytes > maxBytes) {
      const oldest = this.results.keys().next().value;
      if (oldest === undefined || oldest === key) break;
      this.remove(oldest);
    }
  }

  clear(): void {
    for (const k of [...this.results.keys()]) this.remove(k);
    this.inflight.clear();
  }
}
