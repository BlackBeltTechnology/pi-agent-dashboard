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
}

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

  constructor(
    /** Result freshness window (ms). TTL 0 disables result caching. */
    private readonly ttlMs = 2000,
    /** Hard cap on cached entries; oldest/expired evicted past it. */
    private readonly maxEntries = 100,
  ) {}

  /**
   * Return a fresh cached result for `key`, else coalesce onto the in-flight
   * computation for `key`, else run `compute()` once, store, and return it.
   */
  async run(key: string, compute: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.results.get(key);
    if (hit && hit.expires > now) return hit.value;

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

  private store(key: string, value: T): void {
    if (this.ttlMs <= 0) return;
    const now = Date.now();
    this.results.set(key, { value, expires: now + this.ttlMs });
    if (this.results.size <= this.maxEntries) return;
    // Over cap: drop expired first, then oldest (insertion order) until under.
    for (const [k, e] of this.results) {
      if (e.expires <= now) this.results.delete(k);
    }
    while (this.results.size > this.maxEntries) {
      const oldest = this.results.keys().next().value;
      if (oldest === undefined) break;
      this.results.delete(oldest);
    }
  }

  clear(): void {
    this.results.clear();
    this.inflight.clear();
  }
}
