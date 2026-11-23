/**
 * Preview-egress origin helpers — pure, browser-safe.
 *
 * `canonicalHttpsOrigin` is the single canonical subject form of the
 * `preview-egress` access plane; `isUngrantableEgressOrigin` decides which
 * origins can NEVER be granted (loopback / private / LAN / wildcard-DNS names
 * and the dashboard's own origins). Origin semantics — deliberately separate
 * from the path-oriented `forbidden-subjects`.
 *
 * See change: improve-canvas-html-and-url-ux (design D7).
 */

/**
 * WHATWG-canonical `https` origin: lowercase, punycode, trailing-dot stripped,
 * default port elided. `null` for a non-https scheme, userinfo, or a
 * non-parseable input.
 */
export function canonicalHttpsOrigin(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname.replace(/\.+$/, "");
  if (!host) return null;
  return `https://${host}${u.port ? `:${u.port}` : ""}`;
}

/** Parse an IPv6 literal (no brackets) into 8 16-bit groups; null when malformed. */
function parseIpv6(addr: string): number[] | null {
  let a = addr.toLowerCase();
  const zone = a.indexOf("%");
  if (zone >= 0) a = a.slice(0, zone);
  // Trailing dotted-quad (IPv4-mapped / compatible forms).
  const quad = a.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (quad) {
    const o = quad.slice(1, 5).map(Number);
    if (o.some((n) => n > 255)) return null;
    a = `${a.slice(0, quad.index)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = a.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(Number.parseInt(g, 16));
  }
  return out;
}

/** True for loopback / unspecified / private / link-local / CGNAT IPv4. */
export function isPrivateIpv4(o: readonly number[]): boolean {
  const [a, b] = o;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    a >= 224 // multicast / reserved / broadcast
  );
}

/** True for unspecified / loopback / ULA / link-local / IPv4-mapped-or-compatible private IPv6. */
export function isPrivateIpv6(g: readonly number[]): boolean {
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  // IPv4-mapped (::ffff:a.b.c.d) / IPv4-compatible (::a.b.c.d)
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    return isPrivateIpv4([g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff]);
  }
  return false;
}

const INTERNAL_SUFFIXES = [".local", ".internal", ".lan", ".home.arpa", ".localhost"];

/** Hostname embeds an IPv4 pattern (`10.0.0.5.example.io`, `127-0-0-1.example.io`). */
function embedsIpv4(host: string): boolean {
  return (
    /(^|\.)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(\.|$)/.test(host) ||
    /(^|[.-])\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3}($|[.-])/.test(host)
  );
}

/**
 * True when `origin` must never be granted as a preview egress origin: not a
 * canonical https origin; `localhost` / `*.localhost`; a loopback / private /
 * link-local / CGNAT / ULA IP literal in any parsed form; a single-label host;
 * an internal suffix; a host embedding an IPv4 pattern (structurally covers
 * wildcard-DNS services); or one of the dashboard's own origins.
 */
export function isUngrantableEgressOrigin(
  origin: string,
  ownOrigins: Iterable<string> = [],
): boolean {
  const canon = canonicalHttpsOrigin(origin);
  if (!canon) return true;
  const u = new URL(canon);
  const host = u.hostname;
  if (host === "localhost" || host.endsWith(".localhost")) return true;

  if (host.startsWith("[")) {
    const g = parseIpv6(host.slice(1, -1));
    if (!g || isPrivateIpv6(g)) return true;
  } else if (/^\d+(\.\d+){0,3}$/.test(host) || /^0x/i.test(host)) {
    // WHATWG already normalised any numeric form to dotted-quad.
    const o = host.split(".").map(Number);
    if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n > 255) || isPrivateIpv4(o)) {
      return true;
    }
  } else {
    if (!host.includes(".")) return true; // single-label
    if (INTERNAL_SUFFIXES.some((s) => host.endsWith(s))) return true;
    if (embedsIpv4(host)) return true;
  }

  for (const own of ownOrigins) {
    try {
      if (new URL(own).origin === u.origin) return true;
    } catch {
      /* ignore malformed own origin */
    }
  }
  return false;
}

/** Extra IPv4 ranges that are never a public unicast peer (docs, benchmarking, 6to4 relay). */
function isReservedIpv4(o: readonly number[]): boolean {
  const [a, b, c] = o;
  return (
    (a === 192 && b === 88 && c === 99) || // 192.88.99.0/24 6to4 relay
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 benchmarking
    (a === 198 && b === 51 && c === 100) || // 198.51.100.0/24 TEST-NET-2
    (a === 203 && b === 0 && c === 113) // 203.0.113.0/24 TEST-NET-3
  );
}

/** Extra IPv6 ranges that are never a public unicast peer (design D12 3c). */
function isReservedIpv6(g: readonly number[]): boolean {
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  return (
    (g[0] === 0x0100 && zero(1, 4)) || // 100::/64 discard-only
    (g[0] === 0x2001 && g[1] === 0) || // 2001::/32 Teredo
    (g[0] === 0x2001 && (g[1] & 0xfff0) === 0x0010) || // 2001:10::/28 ORCHID
    (g[0] === 0x2001 && g[1] === 0x0db8) || // 2001:db8::/32 documentation
    g[0] === 0x2002 || // 2002::/16 6to4
    (g[0] === 0x0064 && g[1] === 0xff9b && (zero(2, 6) || g[2] === 1)) || // 64:ff9b::/96, 64:ff9b:1::/48
    (zero(0, 4) && g[4] === 0xffff) || // ::ffff:0:0:0/96 SIIT-translated
    (zero(0, 4) && g[4] === 0 && g[5] === 0xffff) || // ::ffff:0:0/96 IPv4-mapped (never a resolver answer)
    zero(0, 6) || // ::/96 IPv4-compatible (deprecated)
    (g[0] & 0xffc0) === 0xfec0 || // fec0::/10 site-local
    (g[0] & 0xff00) === 0xff00 // ff00::/8 multicast
  );
}

/**
 * True only for a globally routable unicast IP literal (`dns.lookup` result).
 * Built on {@link isPrivateIpv4}/{@link isPrivateIpv6} plus the documentation,
 * benchmarking, transition and multicast ranges. Strips an IPv6 zone id and
 * FAILS CLOSED on anything it cannot parse (empty, bracketed, hostnames,
 * leading-zero octets).
 *
 * See change: rich-chat-links (design D12).
 */
export function isPublicUnicastAddress(ip: string): boolean {
  if (typeof ip !== "string") return false;
  const addr = ip.split("%")[0];
  const v4 = addr.match(/^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/);
  if (v4) {
    const o = v4.slice(1, 5).map(Number);
    if (o.some((n) => n > 255)) return false;
    return !isPrivateIpv4(o) && !isReservedIpv4(o);
  }
  if (!addr.includes(":")) return false;
  const g = parseIpv6(addr);
  if (!g) return false;
  return !isPrivateIpv6(g) && !isReservedIpv6(g);
}
