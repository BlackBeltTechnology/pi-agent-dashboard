/**
 * Pure-ish webhook URL helpers: validation, SSRF address policy, redaction.
 *
 * Policy (Decision 9): loopback + private-LAN targets are ALLOWED (nanoMuse on
 * the same box / LAN is the main use case). Refused: link-local + cloud
 * metadata (`169.254.0.0/16`, `fe80::/10`, `fd00:ec2::254`, IPv4-mapped forms),
 * and the dashboard's own listen port on a loopback / local-interface address.
 * If ANY resolved address is blocked the target is refused. The same check
 * runs at registration and at every delivery.
 *
 * The URL is a secret (its path/query often carries a key): render it only
 * via `redactWebhookUrl` — `label (origin)` or `origin`.
 * See change: add-server-push-notifications.
 */
import dns from "node:dns";
import net from "node:net";
import os from "node:os";

export type ValidatedUrl = { ok: true; url: URL } | { ok: false; error: string };

export function validateWebhookUrl(raw: unknown): ValidatedUrl {
  if (typeof raw !== "string" || raw.length === 0) return { ok: false, error: "webhook URL is required" };
  let url: URL;
  try {
    url = new URL(raw); // throws on relative URLs
  } catch {
    return { ok: false, error: "webhook URL must be an absolute http(s) URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "webhook URL must use http or https" };
  }
  if (url.username || url.password) return { ok: false, error: "webhook URL must not contain credentials (user:pass@)" };
  if (!url.hostname) return { ok: false, error: "webhook URL must have a host" };
  return { ok: true, url };
}

const blocked = new net.BlockList();
blocked.addSubnet("169.254.0.0", 16, "ipv4");
blocked.addSubnet("fe80::", 10, "ipv6");
blocked.addAddress("fd00:ec2::254", "ipv6");

/** Strip IPv6 brackets as produced by `URL.hostname`. */
function bareHost(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

/** True for link-local / metadata addresses, including IPv4-mapped IPv6 forms. */
export function isBlockedAddress(ip: string): boolean {
  const addr = bareHost(ip);
  const family = net.isIP(addr);
  if (family === 4) return blocked.check(addr, "ipv4");
  if (family === 6) return blocked.check(addr, "ipv6");
  return false;
}

const loopback = new net.BlockList();
loopback.addSubnet("127.0.0.0", 8, "ipv4");
loopback.addAddress("0.0.0.0", "ipv4");
loopback.addAddress("::1", "ipv6");
loopback.addAddress("::", "ipv6");

/**
 * `::ffff:a.b.c.d` / `::ffff:XXXX:XXXX` "is" the IPv4 address `a.b.c.d`. Unmapped
 * before comparing with interface addresses, or `::ffff:<LAN IP>` would slip
 * past the self-target refusal.
 */
function unmapIPv4(ip: string): string {
  const m = /^::ffff:(.+)$/i.exec(ip);
  if (!m) return ip;
  if (net.isIPv4(m[1])) return m[1];
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(m[1]);
  if (!hex) return ip;
  const hi = Number.parseInt(hex[1], 16);
  const lo = Number.parseInt(hex[2], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

function isLocalAddress(rawIp: string): boolean {
  const ip = unmapIPv4(rawIp);
  const family = net.isIP(ip);
  if (family === 0) return false;
  if (loopback.check(ip, family === 4 ? "ipv4" : "ipv6")) return true;
  const lower = ip.toLowerCase();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.address.toLowerCase() === lower) return true;
    }
  }
  return false;
}

export interface VettedAddress {
  address: string;
  family: 4 | 6;
}

export type LookupAll = (hostname: string) => Promise<VettedAddress[]>;

export const defaultLookupAll: LookupAll = async (hostname) => {
  const res = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return res.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

export type VetResult = { ok: true; addresses: VettedAddress[] } | { ok: false; error: string };

export function effectivePort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

/**
 * Resolve every A/AAAA record and refuse if any is blocked, or if the target is
 * the dashboard's own port on a loopback / local-interface address.
 */
export async function resolveAndVet(
  hostname: string,
  port: number,
  selfPort: number | null,
  lookupAll: LookupAll = defaultLookupAll,
): Promise<VetResult> {
  const host = bareHost(hostname);
  let addresses: VettedAddress[];
  const literal = net.isIP(host);
  if (literal) {
    addresses = [{ address: host, family: literal === 6 ? 6 : 4 }];
  } else {
    try {
      addresses = await lookupAll(host);
    } catch {
      return { ok: false, error: "webhook host could not be resolved" };
    }
    if (addresses.length === 0) return { ok: false, error: "webhook host could not be resolved" };
  }
  for (const a of addresses) {
    if (isBlockedAddress(a.address)) return { ok: false, error: "webhook target is a link-local or metadata address" };
    if (selfPort !== null && port === selfPort && isLocalAddress(a.address)) {
      return { ok: false, error: "webhook target is this dashboard" };
    }
  }
  return { ok: true, addresses };
}

/** `label (origin)` or `origin`. Never the path or query. */
export function redactWebhookUrl(raw: string, label?: string): string {
  let origin = "webhook";
  try {
    origin = new URL(raw).origin;
  } catch {
    /* keep placeholder */
  }
  return label ? `${label} (${origin})` : origin;
}
