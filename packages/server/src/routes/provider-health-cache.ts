/**
 * In-memory per-provider health cache. Written on provider save (`PUT /api/providers`)
 * and by the Test button (`POST /api/providers/test`); read (credential-free) by
 * `GET /api/providers`. No persistence file, no background poll.
 * See change: surface-provider-health-in-settings.
 */

export interface ProviderHealth {
  ok: boolean;
  /** HTTP status of the probe response, when the request reached the upstream. */
  status?: number;
  /** Verbatim probe error string (already credential-scrubbed by `probeProvider`). */
  error?: string;
  /** Model count on a successful probe. */
  modelCount?: number;
  /** Epoch millis the probe ran. */
  testedAt: number;
}

const cache = new Map<string, ProviderHealth>();

export function setProviderHealth(name: string, health: ProviderHealth): void {
  cache.set(name, health);
}

/** Drop a single provider's cached health (e.g. saved with an unprobeable config). */
export function deleteProviderHealth(name: string): void {
  cache.delete(name);
}

export function getAllProviderHealth(): Record<string, ProviderHealth> {
  return Object.fromEntries(cache);
}

/** Drop entries for providers no longer present after a save. */
export function retainProviderHealth(names: Iterable<string>): void {
  const keep = new Set(names);
  for (const name of cache.keys()) {
    if (!keep.has(name)) cache.delete(name);
  }
}

/** Test-only: reset the cache between cases. */
export function clearProviderHealth(): void {
  cache.clear();
}
