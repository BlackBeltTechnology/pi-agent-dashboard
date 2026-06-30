/**
 * Network access guard for Fastify routes.
 * Supports loopback, trusted networks (CIDR/wildcard/exact), and authenticated users.
 */
import type { FastifyRequest, FastifyReply } from "fastify";

const LOOPBACK_ADDRESSES = new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
]);

export function isLoopback(ip: string): boolean {
  return LOOPBACK_ADDRESSES.has(ip);
}

/**
 * Returns true if the source IP matches any trusted host entry.
 * Supports exact match, wildcard (e.g. "10.0.0.*"), and CIDR notation (e.g. "192.168.1.0/24").
 */
export function isBypassedHost(sourceIp: string, bypassHosts: string[]): boolean {
  // Strip IPv4-mapped IPv6 prefix (e.g. ::ffff:192.168.1.1 → 192.168.1.1)
  const ip = sourceIp.startsWith("::ffff:") ? sourceIp.slice(7) : sourceIp;
  for (const entry of bypassHosts) {
    if (entry.includes("/")) {
      if (matchCidr(ip, entry)) return true;
    } else if (entry.includes("*")) {
      const pattern = new RegExp("^" + entry.replace(/\./g, "\\.").replace(/\*/g, "\\d+") + "$");
      if (pattern.test(ip)) return true;
    } else {
      if (ip === entry) return true;
    }
  }
  return false;
}

export function matchCidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const bits = parseInt(bitsStr, 10);
  if (isNaN(bits) || bits < 0 || bits > 32) return false;
  const ipNum = ipToNum(ip);
  const baseNum = ipToNum(base);
  if (ipNum === null || baseNum === null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipNum & mask) === (baseNum & mask);
}

export function ipToNum(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let num = 0;
  for (const p of parts) {
    const n = parseInt(p, 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    num = (num << 8) | n;
  }
  return num >>> 0;
}

/**
 * Create a network guard that allows loopback, trusted networks, or authenticated requests.
 * Fastify lifecycle guarantees onRequest (auth) runs before preHandler (this guard).
 */
export function createNetworkGuard(trustedNetworks: string[]) {
  return async function networkGuard(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (isLoopback(request.ip)) return;
    if (trustedNetworks.length > 0 && isBypassedHost(request.ip, trustedNetworks)) return;
    if ((request as any).isAuthenticated) return;
    // Self-describing denial so clients can branch on policy-denial vs
    // transport failure. `error` is the stable machine-readable literal;
    // `reason`/`hint` are human copy. See change:
    // distinguish-offline-from-network-denied.
    reply.code(403).send({
      success: false,
      error: "network_not_allowed",
      reason: "Source IP not loopback, not in trustedNetworks, and request not authenticated.",
      hint: "Add this network to trustedNetworks (Settings → Servers) or sign in.",
    });
  };
}

/**
 * Convert a netmask to CIDR prefix length.
 * E.g. "255.255.255.0" → 24
 */
export function netmaskToCidrBits(netmask: string): number {
  const num = ipToNum(netmask);
  if (num === null) return 0;
  let bits = 0;
  let n = num;
  while (n & 0x80000000) {
    bits++;
    n = (n << 1) >>> 0;
  }
  return bits;
}

/**
 * Compute the network address from an IP and netmask.
 * E.g. ("192.168.1.42", "255.255.255.0") → "192.168.1.0"
 */
export function networkAddress(ip: string, netmask: string): string {
  const ipNum = ipToNum(ip);
  const maskNum = ipToNum(netmask);
  if (ipNum === null || maskNum === null) return ip;
  const net = (ipNum & maskNum) >>> 0;
  return [
    (net >>> 24) & 0xff,
    (net >>> 16) & 0xff,
    (net >>> 8) & 0xff,
    net & 0xff,
  ].join(".");
}

/** Legacy localhost-only guard. Prefer createNetworkGuard() for new code. */
export async function localhostGuard(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!isLoopback(request.ip)) {
    reply.code(403).send({ success: false, error: "localhost only" });
  }
}
