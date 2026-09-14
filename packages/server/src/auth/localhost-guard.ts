/**
 * Network access guard for Fastify routes.
 * Supports loopback, trusted networks (CIDR/wildcard/exact), and authenticated users.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { blockEvents } from "../tunnel/tunnel-block-events.js";
import { verifyLocalToken } from "./local-token.js";
import { isLoopback } from "./loopback.js";

/**
 * Request headers a reverse proxy / tunnel injects. Their presence on a
 * loopback-sourced request proves the connection traversed a proxy hop (e.g. a
 * zrok public frontend) rather than originating on this host. (D10, narrowed:
 * close the tunnel-as-127.0.0.1 bypass without forcing same-desktop browser
 * auth.) This is a heuristic — a marker-less reverse tunnel (`ssh -R`) injects
 * none of these; affirmative genuine-local trust for process callers is granted
 * separately by the local-token allowlist (see `local-token.ts`).
 */
const PROXY_FORWARDING_HEADERS = [
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "forwarded",
] as const;

/**
 * The same list EXTENDED with `via`, `x-forwarded-server`, `x-forwarded-port`
 * — used ONLY for plugin-registered WS scopes (change: add-browser-relay D1).
 * Core callers keep the 5-header list above: widening the shared constant
 * would change core admission; plugin scopes get the stricter set.
 */
const PLUGIN_PROXY_FORWARDING_HEADERS = [
  ...PROXY_FORWARDING_HEADERS,
  "via",
  "x-forwarded-server",
  "x-forwarded-port",
] as const;

type HeaderBag = Record<string, unknown> | undefined;

/**
 * True if the request carries any proxy/tunnel forwarding header. Pass
 * `{ extended: true }` for the plugin-scope 8-header list (see
 * {@link PLUGIN_PROXY_FORWARDING_HEADERS}); the default is the core list.
 */
export function hasProxyForwardingHeaders(
  headers: HeaderBag,
  opts?: { extended?: boolean },
): boolean {
  if (!headers) return false;
  const list = opts?.extended ? PLUGIN_PROXY_FORWARDING_HEADERS : PROXY_FORWARDING_HEADERS;
  for (const h of list) {
    if (headers[h] != null) return true;
  }
  return false;
}

/**
 * True only for a request that is BOTH from a loopback address AND free of any
 * proxy-forwarding header — i.e. genuinely originated on this host, not relayed
 * through a tunnel that merely presents as `127.0.0.1`.
 */
export function isGenuinelyLocal(ip: string, headers: HeaderBag): boolean {
  return isLoopback(ip) && !hasProxyForwardingHeaders(headers);
}

/**
 * Is the request `Host` header a loopback host name — `localhost`,
 * `127.0.0.1`, `[::1]` (or bare `::1`), any port? Fail-closed on anything
 * unparseable (no port stripping unless the suffix is all digits, so
 * `127.0.0.1.evil` stays whole and is refused).
 */
function isLoopbackHostHeader(host: string | undefined): boolean {
  if (!host) return false;
  let name = host.trim().toLowerCase();
  if (name.startsWith("[")) {
    const end = name.indexOf("]");
    if (end < 0) return false;
    return name.slice(1, end) === "::1";
  }
  const colon = name.lastIndexOf(":");
  if (colon >= 0 && /^\d+$/.test(name.slice(colon + 1))) name = name.slice(0, colon);
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}

/**
 * Deterministic genuinely-local predicate for plugin-registered WS scopes
 * (change: add-browser-relay D1): loopback peer AND loopback `Host` AND none
 * of the 8 plugin-scope forwarding headers. Stricter than
 * {@link isGenuinelyLocal} on purpose — tunnel reachability for a plugin
 * endpoint must not depend on whether the tunnel happens to inject markers,
 * so the non-loopback `Host` itself is a refusal regardless of peer IP.
 */
export function isPluginScopePeerLocal(
  ip: string,
  hostHeader: string | undefined,
  headers: HeaderBag,
): boolean {
  return (
    isLoopback(ip) &&
    isLoopbackHostHeader(hostHeader) &&
    !hasProxyForwardingHeaders(headers, { extended: true })
  );
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
      // Escape ALL regex metacharacters (including backslash — a config-supplied
      // entry is data, not a pattern), then map `*` to a digit run. Escaping
      // only `.` let `\` and the other metacharacters through (CodeQL
      // "incomplete string escaping").
      const escaped = entry.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`^${escaped.replace(/\*/g, "\\d+")}$`);
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
export function createNetworkGuard(
  /**
   * A fixed list, or a thunk read on EVERY request. The server passes a thunk
   * over the mtime-gated config snapshot so a trusted network added at runtime
   * applies without a restart — for an `http://` gateway that list is the only
   * way in (D15). See change: config-override-oauth-redirect-base.
   */
  trustedNetworks: string[] | (() => string[]),
  opts?: { localToken?: string },
) {
  const readTrusted = typeof trustedNetworks === "function" ? trustedNetworks : () => trustedNetworks;
  return async function networkGuard(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    // Genuine same-host origin (loopback AND no proxy-forwarding header) OR an
    // affirmative local-IPC token. A tunnel presenting as 127.0.0.1 injects a
    // forwarding header and is NOT exempted here (D10, narrowed).
    if (isGenuinelyLocal(request.ip, request.headers as Record<string, unknown>)) return;
    if (opts?.localToken && verifyLocalToken(request.headers as Record<string, unknown>, opts.localToken)) return;
    const trusted = readTrusted();
    if (trusted.length > 0 && isBypassedHost(request.ip, trusted)) return;
    if ((request as any).isAuthenticated) return;
    // Record the denial into the bounded, anti-poisoning block-event buffer so
    // the UI can offer "Trust this network?". The recorded IP is the SOCKET
    // PEER (`request.ip`) only — never a forwarding header; a proxy-terminated
    // peer is flagged non-trustable. See change: add-tunnel-providers.
    try {
      blockEvents.record(request.ip, {
        proxied: hasProxyForwardingHeaders(request.headers as Record<string, unknown>),
      });
    } catch { /* recording is best-effort, never blocks the denial */ }
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
