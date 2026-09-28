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

const DOTTED_QUAD = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Loopback RANGE predicate: `127.0.0.0/8`, `::1`, `::ffff:127.0.0.0/104`.
 * Wider than {@link isLoopback} (the 3-address set) on purpose — a relay bound
 * to `127.0.0.5` is still a same-host relay. Used ONLY to refuse trust to
 * relayed loopback traffic; genuine-local admission stays set-based.
 * Non-IP input (`localhost`, `""`) → false. Import-free on purpose (see above).
 * See change: fix-trusted-network-tunnel-bypass (D1).
 */
export function isLoopbackRange(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true;
  const v4 = lower.startsWith("::ffff:") ? lower.slice(7) : lower;
  const m = DOTTED_QUAD.exec(v4);
  if (!m) return false;
  if (m.slice(1).some((octet) => Number(octet) > 255)) return false;
  return m[1] === "127";
}
