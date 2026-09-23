/**
 * Network access guard for Fastify routes.
 * Supports loopback, trusted networks (CIDR/wildcard/exact), and authenticated users.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { blockEvents } from "../tunnel/tunnel-block-events.js";
import { isBypassed } from "./bypass-urls.js";
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
 * The denied request's `Origin` header, when it is a string.
 *
 * Recorded additively on the ledger entry so a CORS-refused origin becomes
 * observable rather than surfacing only as an opaque browser failure. The
 * `@fastify/cors` origin callback receives no request, so the guard — the one
 * request-path module that sees both the socket peer and the header — supplies
 * it. Attacker-controlled; `BlockEventBuffer.record` bounds and sanitizes it.
 * See change: add-access-grants-and-review.
 */
function readRequestOrigin(headers: FastifyRequest["headers"]): string | undefined {
  const origin = (headers as Record<string, unknown>).origin;
  return typeof origin === "string" ? origin : undefined;
}

/**
 * Record a denial into the bounded, anti-poisoning block-event buffer that feeds
 * `GET /api/tunnel/block-events` (so the UI can offer "Trust this network?"), then
 * send the self-describing `network_not_allowed` body clients branch on.
 *
 * Shared by the per-route guard (`createNetworkGuard`) and the universal hook
 * (`createNetworkGuardHook`) so the two denial shapes CANNOT drift. The hook
 * denies before Fastify reaches a route's `preHandler`, so if the hook's shape
 * differed, every already-guarded route would change its 403 body and the
 * trust-this-network UI would go dark.
 * See change: add-universal-network-guard.
 */
function sendNetworkDenied(request: FastifyRequest, reply: FastifyReply): void {
  // The recorded IP is the SOCKET PEER (`request.ip`) only — never a forwarding
  // header; a proxy-terminated peer is flagged non-trustable. See change: add-tunnel-providers.
  try {
    blockEvents.record(request.ip, {
      proxied: hasProxyForwardingHeaders(request.headers as Record<string, unknown>),
      // Additive context: which origin the denied request named, if any. It is
      // NOT a dedupe key. See change: add-access-grants-and-review.
      origin: readRequestOrigin(request.headers),
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
}

/**
 * The network-policy pass conditions, in order: genuine-local → local-IPC token
 * → source IP in the trusted set → already authenticated.
 *
 * Shared by `createNetworkGuard` (per-route `preHandler`) and
 * `createNetworkGuardHook` (universal `onRequest`) so the two CANNOT drift. The
 * design leans on the per-route guards as redundant defense-in-depth, which only
 * holds while both sides agree — a synchronized-by-comment copy would let a
 * future edit to one silently diverge the other.
 *
 * Reads the trusted set through a thunk on every call (D15), and stops at the
 * first satisfied condition so `readTrusted()` is NOT invoked for a loopback
 * request.
 */
function hasNetworkPassCondition(
  request: FastifyRequest,
  opts: { readTrusted: () => string[]; localToken?: string },
): boolean {
  const headers = request.headers as Record<string, unknown>;
  // Genuine same-host origin (loopback AND no proxy-forwarding header). A tunnel
  // presenting as 127.0.0.1 injects a forwarding header and is NOT exempted here
  // (D10, narrowed).
  if (isGenuinelyLocal(request.ip, headers)) return true;
  // Affirmative local-IPC token.
  if (opts.localToken && verifyLocalToken(headers, opts.localToken)) return true;
  const trusted = opts.readTrusted();
  if (trusted.length > 0 && isBypassedHost(request.ip, trusted)) return true;
  return Boolean((request as any).isAuthenticated);
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
    if (hasNetworkPassCondition(request, { readTrusted, localToken: opts?.localToken })) return;
    sendNetworkDenied(request, reply);
  };
}

/**
 * Jurisdiction namespaces of the universal guard: the sensitive HTTP surfaces.
 * Anchored on a TRAILING SLASH so `/apiv2` is a near-miss rather than `/api`.
 * Every dangerous route in the server lives under one of these; the
 * namespace-coverage test enforces that. See change: add-universal-network-guard.
 */
const GUARD_JURISDICTION_PREFIXES = ["/api/", "/v1/", "/editor/", "/live/"] as const;

/**
 * Fixed in-namespace public endpoints, compared against the EXACT pathname.
 * - `/api/health` (the liveness probe clients and the tunnel watchdog read).
 * - `/api/identity/login-config` (identity plane, D16): an unauthenticated
 *   browser — the exact login target — must read the pre-auth login descriptor
 *   before it holds a token, so it cannot pass the authed path; it discloses
 *   nothing when the resolver is inert (`{active:false}`).
 * Not copied from `auth-plugin.ts`'s `request.url === "/api/health"`, which
 * misses `?query`; the guard compares the parsed pathname.
 */
const PUBLIC_IN_NAMESPACE_PATHS: ReadonlySet<string> = new Set([
  "/api/health",
  "/api/identity/login-config",
]);

/**
 * Resolve `.` / `..` segments (RFC 3986 "remove_dot_segments") in an already
 * decoded absolute path. `..` above the root is clamped, as RFC 3986 requires.
 */
function removeDotSegments(path: string): string {
  const trailingSlash = path.length > 1 && path.endsWith("/");
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  const resolved = `/${out.join("/")}`;
  // A trailing slash is preserved, EXCEPT at the root where it is already there
  // (`/a/../` must be `/`, not `//` — RFC 3986).
  return trailingSlash && resolved !== "/" ? `${resolved}/` : resolved;
}

/**
 * Both views of a request target. BOTH are needed, and that is the subtle part.
 *
 * - `resolved` is the RFC 3986 dot-segment-resolved pathname — the request's
 *   TRUE target, and what the in-namespace exceptions are judged against.
 * - `raw` is the decoded pathname exactly as received, dot-segments UNRESOLVED.
 *
 * `raw` cannot be dropped, because routing and this guard disagree about what
 * `..` means. find-my-way does NOT resolve dot-segments; it matches them into a
 * `:param` or `*` slot as a literal VALUE. Measured against the real router:
 *
 *   /api/provider-auth/..        → MATCHES `/api/provider-auth/:provider` (provider = "..")
 *   /api/provider-auth/%2e%2e    → MATCHES the same route (param values are decoded)
 *   /live/x/../..                 → MATCHES `/live/:id/*`
 *
 * so resolving alone would make the guard MORE PERMISSIVE than the router for
 * exactly the routes that take a parameter — and a resolved `/api` is not in
 * jurisdiction under trailing-slash anchoring, so the guard would no-op while the
 * handler ran. (This was a real, reproduced escape in an earlier revision; see
 * the escape-direction cases in `localhost-guard.test.ts`.)
 *
 * The rule is therefore a UNION — in jurisdiction if EITHER view is — which is
 * strictly safer in both directions:
 *   `/api/provider-auth/..`  → raw in jurisdiction         → denied
 *   `/foo/../api/sessions`   → resolved in jurisdiction    → denied
 *   `/foo/../settings`       → neither in jurisdiction     → no-op (SPA served)
 */
export interface GuardTarget {
  raw: string;
  resolved: string;
}

/**
 * Parse a request target into both views, or `null` when it is unparseable.
 *
 * Only origin-form targets (`/path?query#fragment`) are accepted — the form an
 * HTTP/1.1 request line carries. An authority-form or absolute-form target
 * (`//host/x`, `http://host/x`) is anomalous for this server and is reported as
 * unparseable rather than guessed at.
 *
 * `decodeURI` is what makes the parse genuinely fallible: a malformed
 * percent-escape yields `null` instead of a pathname no route could match. The
 * caller FAILS CLOSED on `null` (denies), so a target the guard cannot reason
 * about is never admitted. `%2F` stays encoded (reserved), so an encoded slash
 * does not invent a path boundary, while `.`/`..` (unreserved) do decode and are
 * then resolvable.
 * See change: add-universal-network-guard (design: "Path matching").
 */
export function parseGuardTarget(url: string | undefined): GuardTarget | null {
  if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//")) return null;
  let end = url.length;
  for (const sep of ["?", "#"] as const) {
    const i = url.indexOf(sep);
    if (i >= 0 && i < end) end = i;
  }
  const undecoded = url.slice(0, end);
  if (undecoded.length === 0) return null;
  try {
    const raw = decodeURI(undecoded);
    return { raw, resolved: removeDotSegments(raw) };
  } catch {
    return null;
  }
}

/**
 * The request's resolved pathname, or `null` when the target cannot be parsed.
 * The caller FAILS CLOSED on `null`.
 */
export function guardPathname(url: string | undefined): string | null {
  return parseGuardTarget(url)?.resolved ?? null;
}

/**
 * True when EITHER view of the target lies inside the guard's jurisdiction.
 * See {@link GuardTarget} for why the union is required.
 */
function isGuardedTarget(target: GuardTarget): boolean {
  return isGuardJurisdiction(target.raw) || isGuardJurisdiction(target.resolved);
}

/**
 * True when the pathname lies inside the guard's jurisdiction. Outside
 * jurisdiction the universal hook is a no-op, so static assets, the SPA shell
 * (`/` and the `setNotFoundHandler` deep-link fallback), `/manifest.json`,
 * `/auth/*`, favicon and PWA icons are served exactly as before.
 */
export function isGuardJurisdiction(pathname: string): boolean {
  return GUARD_JURISDICTION_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Best-effort path for a log line when the target is UNPARSEABLE.
 *
 * On that branch `guardPathname` cannot strip the query for us, so it is stripped
 * here — otherwise a malformed target such as `/api/%zz?token=<credential>` would
 * put a credential in `server.log`. Length and control-character hygiene are the
 * sink's job (`sanitizeLogField`).
 */
function bestEffortPathForLog(url: string | undefined): string {
  if (typeof url !== "string") return "<unparseable>";
  let end = url.length;
  for (const sep of ["?", "#"] as const) {
    const i = url.indexOf(sep);
    if (i >= 0 && i < end) end = i;
  }
  const head = url.slice(0, end);
  return head.length > 0 ? head : "<unparseable>";
}

/**
 * One denial is one log line, so a field must never be able to forge a second
 * line or bloat the log. The path is a `decodeURI`-DECODED value, so a target
 * containing `%0a` / `%0d` becomes a real newline before it reaches the sink —
 * without this an attacker could inject counterfeit `[network-guard] denied …`
 * lines. C0 controls, DEL, and the Unicode line separators U+2028 / U+2029 (which
 * a future JSON-per-line log shipper would treat as breaks) are dropped, and each
 * field is bounded.
 *
 * Applied at the EMIT site (see `emitDenial`), not inside `defaultLogDenial`, so
 * an injected `logDenial` receives already-safe fields.
 */
function sanitizeLogField(value: string, max = 200): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    const isLineSeparator = code === 0x2028 || code === 0x2029;
    if (code >= 0x20 && code !== 0x7f && !isLineSeparator) out += ch;
    if (out.length >= max) break;
  }
  return out;
}

/** Stable machine-readable denial reasons (log field, never a response field). */
export const GUARD_DENY_REASON = {
  unparseableUrl: "unparseable-url",
  noPassCondition: "not-local-not-trusted-not-authenticated",
} as const;

export interface GuardDenialLogEntry {
  path: string;
  ip: string;
  reason: string;
}

export interface NetworkGuardHookOptions {
  /**
   * A fixed list, or a thunk read on EVERY request (D15) so a CIDR added at
   * runtime admits without a restart — the same live source the per-route
   * `createNetworkGuard` uses.
   */
  trustedNetworks: string[] | (() => string[]);
  /** Local-IPC allowlist token granting genuine-local trust (D10). */
  localToken?: string;
  /** Live read of configured `auth.bypassUrls` prefixes (in-namespace exception). */
  getBypassUrls?: () => string[];
  /**
   * Live read of the device-facing pairing prefixes that must stay reachable
   * unauthenticated. Injected rather than imported so this module stays free of
   * a `routes/pairing-routes.ts` import (which imports this module back).
   */
  getPairingPrefixes?: () => readonly string[];
  /** Structured denial sink; defaults to a `console.warn` line. */
  logDenial?: (entry: GuardDenialLogEntry) => void;
}

/**
 * Default denial sink. Receives ALREADY-SANITIZED fields (see
 * `sanitizeLogField`) — it formats, it does not clean.
 */
function defaultLogDenial(entry: GuardDenialLogEntry): void {
  console.warn(
    `[network-guard] denied reason=${entry.reason} path=${entry.path} ip=${entry.ip}`,
  );
}

/**
 * The universal network guard, in `onRequest` form.
 *
 * Registered ONCE at the root, LAST, and unconditionally (see `server.ts`) so
 * `/api`, `/v1`, `/editor` and `/live` are covered by construction rather than
 * by a developer remembering to attach a per-route `preHandler`. It runs
 * whether or not auth is configured — with OAuth off the rejecting auth hook is
 * not registered at all, which is precisely the gap this closes.
 *
 * Decision order, all on the parsed PATHNAME:
 *   1. unparseable target → deny (fail closed)
 *   2. outside jurisdiction → return (served as today)
 *   3. in-namespace public exception (`/api/health`, pairing, `bypassUrls`) → return
 *   4. pass condition (genuine-local, local-token, trusted CIDR, isAuthenticated) → return
 *   5. otherwise → log + deny with the shared `network_not_allowed` shape
 *
 * The PASS CONDITIONS are the per-route guard's, unchanged. The EXCEPTIONS are
 * not: a route that matches a configured `bypassUrls` prefix AND carries a
 * per-route `networkGuard` is admitted here and then refused by that
 * `preHandler`. That is exactly today's behavior (`bypassUrls` has only ever
 * skipped the auth plugin), so no regression — recorded so the trade-off is
 * stated rather than implied.
 * See change: add-universal-network-guard.
 */
export function createNetworkGuardHook(opts: NetworkGuardHookOptions) {
  const readTrusted =
    typeof opts.trustedNetworks === "function"
      ? opts.trustedNetworks
      : () => opts.trustedNetworks as string[];
  const logDenial = opts.logDenial ?? defaultLogDenial;
  // Sanitize once, at the EMIT site, so an injected `logDenial` receives
  // already-safe fields rather than having to remember. One denial = one log
  // line: reason + path + socket-peer IP, and NOTHING else — no request body, no
  // Authorization/cookie value, no header dump. A probing LAN or tunnel client
  // becomes observable without the log becoming a credential sink, and no field
  // can forge a second line.
  const emitDenial = (path: string, ip: string, reason: string): void =>
    logDenial({
      reason: sanitizeLogField(reason, 60),
      path: sanitizeLogField(path),
      ip: sanitizeLogField(ip, 60),
    });

  return async function networkGuardHook(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const target = parseGuardTarget(request.url);
    if (target === null) {
      // Fail closed: an unparseable target cannot be PROVEN out of jurisdiction.
      emitDenial(bestEffortPathForLog(request.url), request.ip, GUARD_DENY_REASON.unparseableUrl);
      sendNetworkDenied(request, reply);
      return;
    }

    // Out of jurisdiction — static assets, the SPA shell, `/auth/*`, `/mcp`.
    // The UNION of both views decides this: `raw` catches a target that the
    // router matches into a `:param`/`*` slot as the literal value `..`, while
    // `resolved` catches a target that resolves INTO a guarded namespace. Either
    // one in jurisdiction means deny-by-default. See {@link GuardTarget}.
    if (!isGuardedTarget(target)) return;

    // ── In-namespace public exceptions (reachable unauthenticated) ──
    // Each exception must hold on BOTH views of the target, for the same reason
    // the jurisdiction test is a union: the ROUTER matches the raw path. A
    // resolved-only exception lets an attacker route the raw path into a
    // `:param`/`*` slot while the resolved path names a public route — measured
    // on the real router and reproduced end-to-end:
    //
    //   /live/<registered-id>/../../api/pair/challenge
    //     → resolved `/api/pair/challenge` is a pairing exception → ADMITTED
    //     → router matches `/live/:id/*` → the live proxy runs with
    //       attacker-chosen subPath `../../api/pair/challenge`
    //
    // Requiring both costs nothing legitimate: a clean client sends raw ==
    // resolved, and a dotted request from a GENUINE-LOCAL or trusted caller still
    // passes through the pass conditions below.
    // HEAD is admitted alongside GET: Fastify auto-exposes HEAD for a GET route.
    const methodAllowsHealth = request.method === "GET" || request.method === "HEAD";
    const pairingPrefixes = opts.getPairingPrefixes?.() ?? [];
    const bypassUrls = opts.getBypassUrls?.() ?? [];
    const isPublicInNamespace = (path: string): boolean =>
      (PUBLIC_IN_NAMESPACE_PATHS.has(path) && methodAllowsHealth) ||
      pairingPrefixes.some((prefix) => path.startsWith(prefix)) ||
      isBypassed(path, bypassUrls);
    if (isPublicInNamespace(target.raw) && isPublicInNamespace(target.resolved)) return;

    // ── Pass conditions (shared with the per-route guard) ──
    if (hasNetworkPassCondition(request, { readTrusted, localToken: opts.localToken })) return;

    // The logged path is the RAW (decoded) one: it is what the caller actually
    // sent, so a probe is recorded faithfully. Detail is bounded + sanitized.
    emitDenial(target.raw, request.ip, GUARD_DENY_REASON.noPassCondition);
    sendNetworkDenied(request, reply);
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
