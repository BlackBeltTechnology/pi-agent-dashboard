/**
 * Loopback address predicate — a leaf module with no project dependencies.
 *
 * Extracted from `localhost-guard.ts` to break the import cycle
 * `localhost-guard -> tunnel-block-events -> localhost-guard`: the guard needs
 * `blockEvents` to record denials, and the block-event recorder needs
 * `isLoopback` to decide trustability. Both now depend on this leaf instead of
 * each other. Keep it free of PROJECT imports so neither side can re-form the
 * cycle (the `node:net` builtin is fine).
 *
 * See change: cleanup-import-cycles (D1).
 */
import { BlockList, isIPv4, isIPv6 } from "node:net";

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function isLoopback(ip: string): boolean {
  return LOOPBACK_ADDRESSES.has(ip);
}

/**
 * Loopback RANGE predicate: `127.0.0.0/8`, `::1`, `::ffff:127.0.0.0/104` — in
 * EVERY textual form (`::ffff:7f00:1`, `0:0:0:0:0:0:0:1`, upper-case), via
 * `node:net` `BlockList`, which normalizes IPv6 and matches IPv4-mapped
 * addresses against the IPv4 subnet. Wider than {@link isLoopback} (the
 * 3-address set) on purpose — a relay bound to `127.0.0.5` is still a same-host
 * relay. Used ONLY to refuse trust to relayed loopback traffic; genuine-local
 * admission stays set-based. Non-IP input (`localhost`, `""`) → false.
 * `node:net` is a builtin, not a project module, so the leaf stays cycle-free.
 * See change: fix-trusted-network-tunnel-bypass (D1).
 */
const LOOPBACK_RANGE = new BlockList();
LOOPBACK_RANGE.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK_RANGE.addAddress("::1", "ipv6");

export function isLoopbackRange(ip: string): boolean {
  if (isIPv4(ip)) return LOOPBACK_RANGE.check(ip, "ipv4");
  if (isIPv6(ip)) return LOOPBACK_RANGE.check(ip, "ipv6");
  return false;
}
