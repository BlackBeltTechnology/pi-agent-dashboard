/**
 * Loopback address predicate — a leaf module with no dependencies.
 *
 * Extracted from `localhost-guard.ts` to break the import cycle
 * `localhost-guard -> tunnel-block-events -> localhost-guard`: the guard needs
 * `blockEvents` to record denials, and the block-event recorder needs
 * `isLoopback` to decide trustability. Both now depend on this leaf instead of
 * each other. Keep it import-free so neither side can re-form the cycle.
 *
 * See change: cleanup-import-cycles (D1).
 */

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function isLoopback(ip: string): boolean {
  return LOOPBACK_ADDRESSES.has(ip);
}
