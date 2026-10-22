/**
 * Route model for server identities: one pure, I/O-free module shared by the
 * dashboard server, the browser client and Electron.
 *
 * A server is its identity (fingerprint); an address at which it answers is a
 * {@link Route}. This module owns the rules that turn addresses into rows:
 * host normalisation, derived route kind (never stored), grouping (D1), best
 * route (D3), validation of routes delivered at pairing (D7) and the pair
 * action per client (D8).
 *
 * See change: group-servers-by-identity (design D1–D4, D7, D8, D11).
 */

export type RouteScheme = "http" | "https";
/** How a route was learned. `config` is not a source: legacy entries are `saved`. */
export type RouteSource = "saved" | "mdns" | "pairing";
export type RouteKind = "loopback" | "lan" | "mdns" | "tunnel" | "public";

/** The persisted shape of a route: host, port, scheme and source only (kind is derived). */
export interface Route {
  host: string;
  port: number;
  scheme: RouteScheme;
  source: RouteSource;
}

/** A route is "similar" in latency to another within this many ms (inclusive, D11). */
export const SIMILAR_LATENCY_MS = 50;
/** At most this many delivered routes are kept (D7). */
export const MAX_DELIVERED_ROUTES = 8;
const MAX_HOST_CHARS = 253;

export const ROUTE_SCHEMES: readonly RouteScheme[] = ["http", "https"];
export const ROUTE_SOURCES: readonly RouteSource[] = ["saved", "mdns", "pairing"];

/** Scheme a legacy `host`/`port` pair is read as: `https` on 443, else `http`. */
export function defaultSchemeForPort(port: number): RouteScheme {
  return port === 443 ? "https" : "http";
}

/** Valid TCP port: integer in 1..65535. */
export function isValidPort(port: unknown): port is number {
  return typeof port === "number" && Number.isInteger(port) && port >= 1 && port <= 65535;
}

// ── Host normalisation (D4, D11) ──────────────────────────────────────

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function parseIpv4(text: string): Uint8Array | null {
  const m = IPV4_RE.exec(text);
  if (!m) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const n = Number(m[i + 1]);
    if (n > 255) return null;
    bytes[i] = n;
  }
  return bytes;
}

/** Hex groups of one `::`-free side of an IPv6 literal; null when any group is malformed. */
function ipv6Groups(side: string): number[] | null {
  if (side === "") return [];
  const out: number[] = [];
  for (const g of side.split(":")) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    out.push(Number.parseInt(g, 16));
  }
  return out;
}

/** Parse an IPv6 literal (no brackets, no zone) into 16 bytes; embedded IPv4 tail supported. */
function parseIpv6(text: string): Uint8Array | null {
  if (!/^[0-9a-f:.]+$/i.test(text) || !text.includes(":")) return null;
  let head = text;
  let tail: number[] = [];
  if (head.includes(".")) {
    const cut = head.lastIndexOf(":");
    const v4 = parseIpv4(head.slice(cut + 1));
    if (!v4) return null;
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    // `::1.2.3.4` keeps its `::`; `a:b:1.2.3.4` loses the dangling `:`.
    head = head.slice(0, cut + 1);
    if (!head.endsWith("::")) head = head.slice(0, -1);
  }
  const halves = head.split("::");
  if (halves.length > 2) return null;
  const left = ipv6Groups(halves[0]);
  const right = halves.length === 2 ? ipv6Groups(halves[1]) : [];
  if (!left || !right) return null;
  const zeros = halves.length === 2 ? 8 - left.length - right.length - tail.length : 0;
  const all = [...left, ...new Array<number>(Math.max(zeros, 0)).fill(0), ...right, ...tail];
  if (all.length !== 8 || (halves.length === 2 && zeros < 1)) return null;
  const bytes = new Uint8Array(16);
  all.forEach((g, i) => {
    bytes[i * 2] = g >> 8;
    bytes[i * 2 + 1] = g & 0xff;
  });
  return bytes;
}

function isIpv4Mapped(b: Uint8Array): boolean {
  for (let i = 0; i < 10; i++) if (b[i] !== 0) return false;
  return b[10] === 0xff && b[11] === 0xff;
}

/**
 * One spelling per host: trimmed, lower-cased, brackets and an IPv6 zone id
 * removed, one trailing dot removed, an IPv4-mapped IPv6 literal rewritten as
 * its IPv4 address. Used before classifying and before comparing hosts.
 */
export function normalizeHost(host: string): string {
  let h = host.trim().toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  const zone = h.indexOf("%");
  if (zone !== -1) h = h.slice(0, zone);
  if (h.endsWith(".")) h = h.slice(0, -1);
  if (h.includes(":")) {
    const bytes = parseIpv6(h);
    if (bytes && isIpv4Mapped(bytes)) return `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
  }
  return h;
}

/** Stable identity of a route for de-duplication: scheme, normalised host, port. */
export function routeKey(route: Pick<Route, "host" | "port" | "scheme">): string {
  return `${route.scheme}://${normalizeHost(route.host)}:${route.port}`;
}

// ── Route kind (D4) ───────────────────────────────────────────────────

function ipv4Kind(b: Uint8Array): RouteKind {
  if (b[0] === 127) return "loopback";
  if (
    b[0] === 10 ||
    (b[0] === 172 && b[1] >= 16 && b[1] <= 31) ||
    (b[0] === 192 && b[1] === 168) ||
    (b[0] === 100 && b[1] >= 64 && b[1] <= 127) ||
    (b[0] === 169 && b[1] === 254)
  ) {
    return "lan";
  }
  return "public";
}

function ipv6Kind(b: Uint8Array): RouteKind {
  if (b.slice(0, 15).every((x) => x === 0) && b[15] === 1) return "loopback";
  if ((b[0] & 0xfe) === 0xfc || (b[0] === 0xfe && (b[1] & 0xc0) === 0x80)) return "lan";
  return "public";
}

/**
 * Derived, never persisted. `lan` mirrors the knock gate's private ranges
 * (a boundary-table test pins them together); `tunnel` is `zrok.io` over https
 * only, the one tunnel host the code names; everything unlisted is `public`.
 */
export function classifyRoute(route: { host: string; scheme: RouteScheme }): RouteKind {
  const h = normalizeHost(route.host);
  if (!h) return "public";
  const v4 = parseIpv4(h);
  if (v4) return ipv4Kind(v4);
  if (h.includes(":")) {
    const v6 = parseIpv6(h);
    return v6 ? ipv6Kind(v6) : "public";
  }
  if (h === "localhost") return "loopback";
  if (h.endsWith(".local")) return "mdns";
  if (route.scheme === "https" && (h === "zrok.io" || h.endsWith(".zrok.io"))) return "tunnel";
  if (!h.includes(".") || h.endsWith(".lan") || h.endsWith(".home.arpa") || h.endsWith(".internal")) return "lan";
  return "public";
}

/** On-link = a knock may be possible: kind `lan` or `mdns`, over plain http. */
export function isOnLinkRoute(route: { host: string; scheme: RouteScheme }): boolean {
  if (route.scheme !== "http") return false;
  const kind = classifyRoute(route);
  return kind === "lan" || kind === "mdns";
}

/** Primary route: the first `http` route, else the first route. */
export function primaryRoute<R extends Pick<Route, "scheme">>(routes: readonly R[]): R | undefined {
  return routes.find((r) => r.scheme === "http") ?? routes[0];
}

// ── Grouping (D1) ─────────────────────────────────────────────────────

export interface RouteEntry {
  fingerprint?: string;
  routes: readonly Route[];
}

/** A route plus the fingerprint it proved (or advertised); none ⇒ identity not known. */
export interface ProvenRoute {
  route: Route;
  fingerprint?: string;
}

export interface GroupedEntry {
  fingerprint?: string;
  routes: Route[];
  /** Indices (in the result) of other entries holding the same fingerprint on another instance port. */
  sameIdentityAs: number[];
  /** False for an entry with no known fingerprint ("identity not advertised"). */
  identityAdvertised: boolean;
  /** Index of the input entry this one grew from; absent for entries created here. */
  sourceIndex?: number;
}

/** Does `routes` already hold `route` (same scheme, normalised host, port)? */
function holdsRoute(routes: readonly Route[], route: Route): boolean {
  const key = routeKey(route);
  return routes.some((r) => routeKey(r) === key);
}

/**
 * Index of the entry a route proving `fingerprint` joins, or -1 for "start a
 * new entry". An `https` route joins the FIRST entry holding the fingerprint
 * (stored order decides, not port); an `http` route joins the first holder that
 * has no `http` route yet or already has one on the same port.
 */
export function findAttachTarget(entries: readonly RouteEntry[], route: Route, fingerprint: string | undefined): number {
  if (fingerprint === undefined) return -1;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.fingerprint !== fingerprint) continue;
    if (route.scheme === "https") return i;
    const httpRoutes = entry.routes.filter((r) => r.scheme === "http");
    if (httpRoutes.length === 0 || httpRoutes.some((r) => r.port === route.port)) return i;
  }
  return -1;
}

/**
 * Group `incoming` routes into `entries` (copied, never mutated). A route with
 * no fingerprint joins the entry that already holds the same route, else is a
 * single-route entry. A route already held is not duplicated; the first
 * spelling and source win.
 */
export function groupRoutes(entries: readonly RouteEntry[], incoming: readonly ProvenRoute[]): GroupedEntry[] {
  const out: GroupedEntry[] = entries.map((e, i) => ({
    ...(e.fingerprint !== undefined ? { fingerprint: e.fingerprint } : {}),
    routes: [...e.routes],
    sameIdentityAs: [],
    identityAdvertised: e.fingerprint !== undefined,
    sourceIndex: i,
  }));
  for (const { route, fingerprint } of incoming) {
    let target = findAttachTarget(out, route, fingerprint);
    if (target === -1 && fingerprint === undefined) {
      target = out.findIndex((e) => holdsRoute(e.routes, route));
    }
    if (target === -1) {
      out.push({
        ...(fingerprint !== undefined ? { fingerprint } : {}),
        routes: [route],
        sameIdentityAs: [],
        identityAdvertised: fingerprint !== undefined,
      });
    } else if (!holdsRoute(out[target].routes, route)) {
      out[target].routes.push(route);
    }
  }
  out.forEach((entry, i) => {
    if (entry.fingerprint === undefined) return;
    out.forEach((other, j) => {
      if (j !== i && other.fingerprint === entry.fingerprint) entry.sameIdentityAs.push(j);
    });
  });
  return out;
}

// ── Best route (D3) ───────────────────────────────────────────────────

/** A route with its check result; `latencyMs` is the identity-challenge round trip. */
export type RankableRoute<R extends Route = Route> = R & {
  /** The challenge proved the group's fingerprint. Anything else is never a candidate. */
  proven: boolean;
  latencyMs?: number;
  /** Seen by discovery this session rather than stored (credentialed order only). */
  discovered?: boolean;
};

function fastest<T extends { latencyMs?: number }>(routes: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const r of routes) {
    if (!best || (r.latencyMs ?? Number.POSITIVE_INFINITY) < (best.latencyMs ?? Number.POSITIVE_INFINITY)) best = r;
  }
  return best;
}

/**
 * Pick the route in use among the PROVEN ones; `null` when none is.
 *
 * `credentialed: false` (list marker, in-page switch): `https` wins when its
 * latency is within {@link SIMILAR_LATENCY_MS} of the fastest `http` (inclusive),
 * otherwise the lowest latency wins.
 *
 * `credentialed: true` (the app sends a stored bearer, Electron): stored https,
 * then stored http (input order), then discovered; the first proven route wins
 * and latency is never compared, so a faster http route cannot downgrade a
 * bearer-carrying open to cleartext.
 */
export function rankRoutes<R extends RankableRoute>(routes: readonly R[], opts: { credentialed: boolean }): R | null {
  const candidates = routes.filter((r) => r.proven);
  if (candidates.length === 0) return null;
  if (opts.credentialed) {
    const stored = candidates.filter((r) => !r.discovered);
    const discovered = candidates.filter((r) => r.discovered);
    return (
      stored.find((r) => r.scheme === "https") ??
      stored.find((r) => r.scheme === "http") ??
      discovered.find((r) => r.scheme === "https") ??
      discovered[0] ??
      null
    );
  }
  const bestHttp = fastest(candidates.filter((r) => r.scheme === "http"));
  const bestHttps = fastest(candidates.filter((r) => r.scheme === "https"));
  if (!bestHttp) return bestHttps ?? null;
  if (!bestHttps) return bestHttp;
  const gap = (bestHttps.latencyMs ?? Number.POSITIVE_INFINITY) - (bestHttp.latencyMs ?? Number.POSITIVE_INFINITY);
  return gap <= SIMILAR_LATENCY_MS ? bestHttps : bestHttp;
}

// ── Delivered routes (D7) ─────────────────────────────────────────────

const DNS_NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/**
 * Validate ONE delivered route origin; returns its normalised origin or null.
 * `https` only; origin only (the bare trailing slash is accepted); a DNS name
 * that is not an IP literal, `localhost` or `*.local`; host at most 253 chars.
 */
export function validateDeliveredOrigin(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const m = /^https:\/\/([^/?#@\s\\]+)\/?$/i.exec(input);
  if (!m) return null;
  let url: URL;
  try {
    url = new URL(`https://${m[1]}`);
  } catch {
    return null;
  }
  const host = url.hostname;
  if (host.length === 0 || host.length > MAX_HOST_CHARS) return null;
  if (url.username || url.password) return null;
  const name = host.endsWith(".") ? host.slice(0, -1) : host;
  if (!DNS_NAME_RE.test(name)) return null; // also rejects IPv6 (brackets) and anything URL parsing normalised oddly
  if (parseIpv4(name)) return null;
  if (name === "localhost" || name.endsWith(".local")) return null;
  return url.origin;
}

/**
 * Validate the `routes` of an approved poll or the urls of a pairing payload:
 * keep the valid origins, normalised, de-duplicated, in delivery order, at most
 * {@link MAX_DELIVERED_ROUTES}. Anything not an array yields nothing.
 */
export function validateDeliveredRoutes(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const item of input) {
    const origin = validateDeliveredOrigin(item);
    if (origin === null || out.includes(origin)) continue;
    out.push(origin);
    if (out.length >= MAX_DELIVERED_ROUTES) break;
  }
  return out;
}

/** A validated delivered origin as a persistable route (source `pairing`). */
export function originToRoute(origin: string): Route {
  const url = new URL(origin);
  return { host: url.hostname, port: url.port ? Number(url.port) : 443, scheme: "https", source: "pairing" };
}

// ── Request page URL ──────────────────────────────────────────────────

/**
 * `http://<host>:<port>/pair?request`, built only from a route's host and port
 * and refused (null) unless the result round-trips to exactly them: no userinfo,
 * path, query or fragment smuggled in the host, port 1..65535, IPv6 bracketed.
 */
export function buildRequestPageUrl(host: string, port: number): string | null {
  if (!isValidPort(port)) return null;
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (!bare || /[\s/\\?#@%]/.test(bare)) return null;
  const authority = bare.includes(":") ? `[${bare}]` : bare;
  const built = `http://${authority}:${port}/pair?request`;
  let url: URL;
  try {
    url = new URL(built);
  } catch {
    return null;
  }
  const portOk = url.port === String(port) || (port === 80 && url.port === "");
  const roundTrips =
    url.protocol === "http:" &&
    !url.username &&
    !url.password &&
    url.hostname === authority.toLowerCase() &&
    portOk &&
    url.pathname === "/pair" &&
    url.search === "?request" &&
    url.hash === "";
  return roundTrips ? built : null;
}

// ── Pair action (D8) ──────────────────────────────────────────────────

export type PairClient = "browser" | "electron";

export interface PairActionInput {
  client: PairClient;
  routes: ReadonlyArray<Route & { discovered?: boolean; inKeyring?: boolean }>;
  /** Advertised or pinned fingerprint of the entry, if any. */
  fingerprint?: string;
  /** This device already holds a credential for the entry. */
  credentialHeld: boolean;
  /** The entry is the dashboard the page is loaded from. */
  isCurrent: boolean;
}

export type PairAction =
  /** Browser: navigate a new context (noopener) to `url`. Electron: `openServerWindow({host, port})`. */
  | { kind: "request-access"; route: Route; url?: string }
  /** Electron only, no fingerprint known: prove, show it in full, request after the user confirms. */
  | { kind: "verify-and-request"; route: Route }
  /** Paste a pairing code; needs a fingerprint to compare against. */
  | { kind: "pair-with-code" };

/**
 * The one pair action for an entry this device has no credential for, or null
 * (no action: state text only). A browser sends and proves nothing from the
 * current page — it only navigates to the peer's own request page — so it never
 * verifies a fingerprint. Electron proves identity before anything is sent.
 */
export function pairAction(input: PairActionInput): PairAction | null {
  if (input.credentialHeld || input.isCurrent) return null;
  const onLink = input.routes.filter(isOnLinkRoute);
  const code: PairAction | null = input.fingerprint ? { kind: "pair-with-code" } : null;

  if (input.client === "browser") {
    const ordered = [...onLink.filter((r) => r.discovered), ...onLink.filter((r) => !r.discovered)];
    for (const r of ordered) {
      const url = buildRequestPageUrl(r.host, r.port);
      if (url) return { kind: "request-access", route: toRoute(r), url };
    }
    return code;
  }

  const discovered = onLink.find((r) => r.discovered);
  if (!input.fingerprint && discovered) return { kind: "verify-and-request", route: toRoute(discovered) };
  const reachable = discovered ?? onLink.find((r) => r.inKeyring);
  if (reachable) return { kind: "request-access", route: toRoute(reachable) };
  return code;
}

function toRoute(r: Route): Route {
  return { host: r.host, port: r.port, scheme: r.scheme, source: r.source };
}
