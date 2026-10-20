/**
 * Network access guard for Fastify routes.
 * Supports loopback, trusted networks (CIDR/wildcard/exact), and authenticated users.
 */

import { isIPv4, isIPv6 } from "node:net";
import os from "node:os";
import { routeTier } from "@blackbelt-technology/pi-dashboard-shared/route-tiers.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import { redactCapability } from "../live-server/live-capability.js";
import { blockEvents } from "../tunnel/tunnel-block-events.js";
import { isBypassed } from "./bypass-urls.js";
import { hasLocalCredential } from "./local-credential.js";
import { hasLocalProof, type LocalTrustContext } from "./local-proof.js";
import { isLoopback, isLoopbackRange } from "./loopback.js";
import { type NetworkOnlySource, noteNetworkOnlyAdmission } from "./network-trust-telemetry.js";

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
export const PLUGIN_PROXY_FORWARDING_HEADERS = [
  ...PROXY_FORWARDING_HEADERS,
  "via",
  "x-forwarded-server",
  "x-forwarded-port",
] as const;

type HeaderBag = Record<string, unknown> | undefined;

/**
 * NAMES of the proxy-forwarding headers present (extended list, a superset of
 * the core list). Never reads values — for diagnostics lines only.
 * See change: harden-ios-safari-memory-and-ws-diagnostics (design D4).
 */
export function forwardingHeaderNamesPresent(headers: HeaderBag): string[] {
  if (!headers) return [];
  return PLUGIN_PROXY_FORWARDING_HEADERS.filter((h) => headers[h] != null);
}

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
 * The ONE admission predicate for "this request originates on this host".
 * Default (no ctx, or `requireLocalProof` off): exactly {@link isGenuinelyLocal}.
 * Strict: additionally requires local proof (cookie or local token), so a
 * marker-less relay presenting as bare loopback is not admitted.
 * See change: harden-trust-and-credential-boundaries (D2).
 */
export function isLocallyTrusted(
  input: { ip: string; headers: HeaderBag },
  ctx?: LocalTrustContext,
): boolean {
  if (!isGenuinelyLocal(input.ip, input.headers)) return false;
  if (!ctx || !ctx.strict()) return true;
  return hasLocalProof(input.headers, ctx);
}

/**
 * May this request see the access-prompting posture (host-gate mode, whether
 * prompting is on, why a denial was not asked about)? Authenticated OR
 * genuinely local — stricter than the network guard, because a trusted-CIDR or
 * local-token caller with no credential must not learn it. One predicate for
 * `/api/health`'s `accessGrants` block and every denial body's `promptOutcome`.
 * See change: surface-denial-remedy-in-previews (design D5).
 */
export function canDiscloseAccessPosture(request: { ip: string; headers: unknown }): boolean {
  return (
    (request as { isAuthenticated?: boolean }).isAuthenticated === true ||
    isGenuinelyLocal(request.ip, request.headers as Record<string, unknown>)
  );
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
  ctx?: LocalTrustContext,
): boolean {
  return (
    isLoopback(ip) &&
    isLoopbackHostHeader(hostHeader) &&
    !hasProxyForwardingHeaders(headers, { extended: true }) &&
    // Strict: a marker-less relay is indistinguishable here; require proof.
    (!ctx || !ctx.strict() || hasLocalProof(headers, ctx))
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

/**
 * A loopback-RANGE socket peer carrying a core proxy-forwarding header: a
 * tunnel agent (zrok, ngrok, `tailscale serve`) or same-host reverse proxy
 * relaying someone else's request. Never trusted by a network entry.
 * See change: fix-trusted-network-tunnel-bypass (D1, D4).
 */
export function isRelayedLoopback(ip: string, headers: HeaderBag): boolean {
  return isLoopbackRange(ip) && hasProxyForwardingHeaders(headers);
}

/**
 * The ONE peer-IP trust predicate. Every trusted-network / bypass-host decision
 * on a socket peer goes through here, never through {@link isBypassedHost}
 * directly (enforced by `trusted-source-single-predicate.test.ts`). A relayed
 * loopback peer is refused even when the list covers loopback / `0.0.0.0/0`:
 * genuine local traffic is admitted by `isGenuinelyLocal` instead.
 * See change: fix-trusted-network-tunnel-bypass (D1).
 */
export function isTrustedSource(
  ip: string,
  headers: HeaderBag,
  trusted: string[],
  ctx?: LocalTrustContext,
): boolean {
  if (trusted.length === 0) return false;
  if (isRelayedLoopback(ip, headers)) return false;
  // Strict: a loopback-range peer without proof cannot be re-admitted by a
  // `127.0.0.1` trusted entry (a marker-less relay looks identical).
  if (ctx?.strict() && isLoopbackRange(ip) && !hasLocalProof(headers, ctx)) return false;
  return isBypassedHost(ip, trusted);
}

const LOOPBACK_PROBES = ["127.0.0.1", "::1", "::ffff:127.0.0.1"] as const;

/**
 * Entries of a trusted list that cover loopback - inert for tunnel traffic,
 * redundant for local traffic. An entry counts when the matcher admits a
 * loopback probe, OR its base (`/n` stripped, `*` -> `0`, a short dotted form
 * padded to four octets) is in the loopback range (catches `127.0.0.5`,
 * `127.0.0.4/30`, `::1/128`, and `127.*` - whose single `*` spans one
 * octet, so the matcher itself never admits a real loopback address).
 * See change: fix-trusted-network-tunnel-bypass (D3).
 */
export function loopbackCoveringEntries(list: readonly string[]): string[] {
  return list.filter((entry) => {
    if (LOOPBACK_PROBES.some((probe) => isBypassedHost(probe, [entry]))) return true;
    let base = entry.split("/")[0].replace(/\*/g, "0");
    if (!base.includes(":")) {
      const octets = base.split(".");
      while (octets.length < 4) octets.push("0");
      base = octets.join(".");
    }
    return isLoopbackRange(base);
  });
}

/**
 * Build a trusted-list observer that warns ONCE per distinct set of
 * loopback-covering entries. Memoized on the array REFERENCE: the config
 * snapshot hands back the same array until a reparse, so a hot-path call on an
 * unchanged list is one reference compare. The dedup key is the sorted
 * covering-entry signature (not the config stamp, which changes on every
 * unrelated write). A factory so the matcher is injectable in tests.
 * See change: fix-trusted-network-tunnel-bypass (D3).
 */
export function createTrustedListNoter(covering: (list: readonly string[]) => string[] = loopbackCoveringEntries) {
  let lastRef: readonly string[] | null = null;
  let lastSignature = "";
  return function noteTrustedList(list: readonly string[]): void {
    if (list === lastRef) return;
    lastRef = list;
    const entries = [...covering(list)].sort();
    const signature = entries.join("\n");
    if (signature !== "" && signature !== lastSignature) {
      console.warn(
        `[trusted-networks] ${entries.map((e) => `"${e}"`).join(", ")} ${entries.length === 1 ? "covers" : "cover"} loopback — ignored for tunnel-relayed requests; local requests are already trusted`,
      );
    }
    lastSignature = signature;
  };
}

/** Process-wide noter, fed by the guard's trusted read and once at boot. */
export const noteTrustedList = createTrustedListNoter();

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
/**
 * Observer told about every network-policy denial, after it is recorded and
 * before the unchanged 403 is sent (design D6). The access-grant coordinator
 * hangs off this ONE shared denial path rather than any individual hook.
 * Best-effort: an observer that throws never blocks or alters the denial.
 * See change: add-access-grant-dialog (task 6.1).
 */
let networkDenialObserver: ((request: FastifyRequest) => void) | null = null;

/** Install (or clear, with `null`) the network-denial observer. */
export function setNetworkDenialObserver(observer: ((request: FastifyRequest) => void) | null): void {
  networkDenialObserver = observer;
}

function sendNetworkDenied(request: FastifyRequest, reply: FastifyReply, localTrust?: LocalTrustContext): void {
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
  // No grant prompt for a relayed-loopback peer: "trust 127.0.0.1?" would name
  // the tunnel agent, and the resulting entry is inert under isTrustedSource
  // (grant->deny loop). See change: fix-trusted-network-tunnel-bypass (D4).
  if (!isRelayedLoopback(request.ip, request.headers as Record<string, unknown>)) {
    try {
      networkDenialObserver?.(request);
    } catch { /* observing is best-effort, never blocks the denial */ }
  }
  // Strict mode: a bare-loopback caller lacking proof gets an actionable denial.
  if (
    localTrust?.strict() &&
    isGenuinelyLocal(request.ip, request.headers as Record<string, unknown>) &&
    !hasLocalProof(request.headers as Record<string, unknown>, localTrust)
  ) {
    reply.code(403).send({
      success: false,
      error: "network_not_allowed",
      reason: "local_proof_required",
      hint: "requireLocalProof is on: open the dashboard with `pi-dashboard open` (or use the desktop app).",
    });
    return;
  }
  // Self-describing denial so clients can branch on policy-denial vs
  // transport failure. `error` is the stable machine-readable literal;
  // `reason`/`hint` are human copy. See change:
  // distinguish-offline-from-network-denied.
  reply.code(403).send({
    success: false,
    error: "network_not_allowed",
    // Identical in every trust mode: this body goes to credential-less callers
    // and must not disclose the mode or point at a trusted list.
    reason: "Source IP is not loopback and the request is not authenticated.",
    hint: "Pair this device (Request access) or sign in.",
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
  opts: { readTrusted: () => string[]; localToken?: string; localTrust?: LocalTrustContext },
): boolean {
  const headers = request.headers as Record<string, unknown>;
  // Genuine same-host origin (loopback AND no proxy-forwarding header). A tunnel
  // presenting as 127.0.0.1 injects a forwarding header and is NOT exempted here
  // (D10, narrowed). Under `requireLocalProof` it additionally needs proof.
  if (isLocallyTrusted({ ip: request.ip, headers }, opts.localTrust)) return true;
  // Strict exceptions for a bare local caller: READ observe-tier REST routes, and
  // the `/v1/*` model proxy (local pi processes call it with no proof; admission is
  // unchanged by design — a documented trade-off).
  if (
    opts.localTrust?.strict() &&
    isGenuinelyLocal(request.ip, headers) &&
    (isObserveApiRequest(request) || isModelProxyRequest(request))
  ) {
    return true;
  }
  // Affirmative local-IPC token.
  if (opts.localToken && hasLocalCredential(headers)) return true;
  // Credentials BEFORE the network match, so a request that holds one is never
  // classified (or counted) as network-only. Admission outcomes are unchanged:
  // both are "allow". See change: retire-trusted-networks-bypass (D3).
  if ((request as any).isAuthenticated) return true;
  const trusted = opts.readTrusted();
  noteTrustedList(trusted);
  if (isTrustedSource(request.ip, headers, trusted, opts.localTrust)) {
    // Admitted by the network match alone — counted once per request (the
    // per-route guard and the universal hook both evaluate it).
    noteNetworkOnlyAdmission(request as unknown as NetworkOnlySource);
    return true;
  }
  return false;
}

/**
 * Is this a `/v1/*` model-proxy request? Judged on the matched route pattern
 * (post-routing), never the raw URL, so dot-segment tricks cannot borrow it.
 * See change: harden-trust-and-credential-boundaries (D2 trade-off).
 */
function isModelProxyRequest(request: FastifyRequest): boolean {
  return (request.routeOptions?.url ?? "").startsWith("/v1/");
}

/**
 * Is this an `/api/*` request whose matched route is `observe`-tier? `onRequest`
 * runs after routing, so `routeOptions.url` is the route PATTERN; an unmatched
 * route is `operate` (fail closed).
 */
export function isObserveApiRequest(request: FastifyRequest): boolean {
  const route = request.routeOptions?.url ?? "";
  return route.startsWith("/api/") && routeTier(request.method, route) === "observe";
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
  opts?: { localToken?: string; localTrust?: LocalTrustContext },
) {
  const readTrusted = typeof trustedNetworks === "function" ? trustedNetworks : () => trustedNetworks;
  return async function networkGuard(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (hasNetworkPassCondition(request, { readTrusted, localToken: opts?.localToken, localTrust: opts?.localTrust })) return;
    sendNetworkDenied(request, reply, opts?.localTrust);
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
  /** Strict local-proof context (`requireLocalProof`); absent ⇒ default behaviour. */
  localTrust?: LocalTrustContext;
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
      // A live-preview capability token in a refused path must not reach the log.
      path: sanitizeLogField(redactCapability(path)),
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
    if (hasNetworkPassCondition(request, { readTrusted, localToken: opts.localToken, localTrust: opts.localTrust })) return;

    // The logged path is the RAW (decoded) one: it is what the caller actually
    // sent, so a probe is recorded faithfully. Detail is bounded + sanitized.
    emitDenial(target.raw, request.ip, GUARD_DENY_REASON.noPassCondition);
    sendNetworkDenied(request, reply, opts.localTrust);
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

// ── LAN knock peer-address predicates ────────────────────────────────
// See change: add-lan-knock-pairing (design D3, D4).

/** A parsed peer address: 4 or 16 bytes, plus its canonical text form. */
export interface ParsedIp {
  family: 4 | 6;
  bytes: Uint8Array;
  /** Canonical text: dotted quad, or zone-less lower-case compressed IPv6. */
  text: string;
}

function compressIpv6(groups: number[]): string {
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestLen < 2) return hex.join(":");
  return `${hex.slice(0, bestStart).join(":")}::${hex.slice(bestStart + bestLen).join(":")}`;
}

/** Expand an IPv6 literal (no zone) to its 8 groups, or null. */
function ipv6Groups(raw: string): number[] | null {
  // Embedded IPv4 tail (`::ffff:1.2.3.4`) → two hex groups.
  let body = raw;
  const lastColon = body.lastIndexOf(":");
  const tail = body.slice(lastColon + 1);
  if (tail.includes(".")) {
    const o = tail.split(".").map(Number);
    body = `${body.slice(0, lastColon + 1)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = body.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...rest].map((g) => Number.parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}

/**
 * Parse an IPv4 / IPv6 literal (zone id stripped, IPv4-mapped IPv6 unwrapped to
 * IPv4). Anything that is not an IP literal → `null`. Never throws.
 */
export function parseIpAddress(input: unknown): ParsedIp | null {
  if (typeof input !== "string" || input.length === 0 || input.length > 80) return null;
  const pct = input.indexOf("%");
  const raw = (pct === -1 ? input : input.slice(0, pct)).toLowerCase();
  if (isIPv4(raw)) {
    const octets = raw.split(".").map(Number);
    return { family: 4, bytes: Uint8Array.from(octets), text: octets.join(".") };
  }
  const groups = isIPv6(raw) ? ipv6Groups(raw) : null;
  if (!groups) return null;
  // IPv4-mapped (::ffff:a.b.c.d) → the IPv4 form.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const bytes = Uint8Array.from([groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff]);
    return { family: 4, bytes, text: Array.from(bytes).join(".") };
  }
  const bytes = new Uint8Array(16);
  groups.forEach((g, i) => {
    bytes[i * 2] = g >> 8;
    bytes[i * 2 + 1] = g & 0xff;
  });
  return { family: 6, bytes, text: compressIpv6(groups) };
}

/** Private ranges a knock may come from (design D4); loopback is NOT one. */
function isPrivateIp(p: ParsedIp): boolean {
  const b = p.bytes;
  if (p.family === 4) {
    return (
      b[0] === 10 ||
      (b[0] === 172 && b[1] >= 16 && b[1] <= 31) ||
      (b[0] === 192 && b[1] === 168) ||
      (b[0] === 100 && b[1] >= 64 && b[1] <= 127) ||
      (b[0] === 169 && b[1] === 254)
    );
  }
  return (b[0] & 0xfe) === 0xfc || (b[0] === 0xfe && (b[1] & 0xc0) === 0x80);
}

function isLoopbackIp(p: ParsedIp): boolean {
  if (p.family === 4) return p.bytes[0] === 127;
  return p.bytes.slice(0, 15).every((x) => x === 0) && p.bytes[15] === 1;
}

/** A non-internal interface address the server serves on. */
export interface LanInterface {
  address: string;
  netmask: string;
}

/** Leading-ones length of a netmask, or null when it is unparsable or /0 (matches nothing safely). */
function prefixBits(netmask: string): number | null {
  const m = parseIpAddress(netmask);
  if (!m) return null;
  let bits = 0;
  for (const byte of m.bytes) {
    if (byte === 0xff) {
      bits += 8;
      continue;
    }
    let b = byte;
    while (b & 0x80) {
      bits++;
      b = (b << 1) & 0xff;
    }
    break;
  }
  return bits === 0 ? null : bits;
}

function sameNetwork(a: Uint8Array, b: Uint8Array, bits: number): boolean {
  const full = Math.floor(bits / 8);
  for (let i = 0; i < full; i++) if (a[i] !== b[i]) return false;
  const rem = bits % 8;
  if (rem === 0) return true;
  const mask = (0xff << (8 - rem)) & 0xff;
  return (a[full] & mask) === (b[full] & mask);
}

/**
 * Is `ip` a private, non-loopback address inside the subnet of one of
 * `interfaces`? A missing / unparsable address fails closed.
 */
export function isOnLinkPrivate(ip: string | undefined, interfaces: readonly LanInterface[]): boolean {
  const peer = parseIpAddress(ip);
  if (!peer || isLoopbackIp(peer) || !isPrivateIp(peer)) return false;
  for (const iface of interfaces) {
    const own = parseIpAddress(iface.address);
    if (!own || own.family !== peer.family) continue;
    const bits = prefixBits(iface.netmask);
    // An unparsable / zero mask must never admit the whole address family; a /32 (or
    // /128) point-to-point interface has no neighbours.
    if (bits === null || bits >= peer.bytes.length * 8) continue;
    if (sameNetwork(peer.bytes, own.bytes, bits)) return true;
  }
  return false;
}

/**
 * Does this entry match every address? `x/0` for any base or spelling (`0.0.0.0/00`,
 * `::0/0`, `1.2.3.4/0`), or a wildcard of only `*` — never a knock-eligibility grant.
 */
function isMatchAllEntry(entry: string): boolean {
  const slash = entry.indexOf("/");
  if (slash >= 0) return Number.parseInt(entry.slice(slash + 1), 10) === 0;
  return /^[*.]+$/.test(entry) && entry.includes("*");
}

/**
 * Knock eligibility from the configured list: may `peer` KNOCK because an entry
 * of the raw trusted list covers it? Applies only to a request with NO
 * proxy-forwarding header at all (as strict as the private-range branch), ignores
 * match-all entries, and does not require the peer to be on-link. A relayed
 * loopback peer is refused (it carries a forwarding header). It authenticates
 * nothing — it only widens where a knock may come from.
 * See change: retire-trusted-networks-bypass (D7).
 */
export function isKnockListedPeer(
  peer: string | undefined,
  headers: HeaderBag,
  list: readonly string[],
): boolean {
  if (!peer || hasProxyForwardingHeaders(headers)) return false;
  const entries = list.map((e) => e.trim()).filter((e) => e !== "" && !isMatchAllEntry(e));
  return entries.length > 0 && isBypassedHost(peer, entries);
}

/**
 * The per-source identity of a knock: the full address (IPv6 without zone,
 * IPv4-mapped unwrapped). Deliberately NOT a /64 — see design D4.
 */
export function knockSourceKey(ip: string): string {
  return parseIpAddress(ip)?.text ?? ip;
}

const LAN_INTERFACE_TTL_MS = 30_000;

/** Does the server's bind host cover an interface address? Wildcard / non-IP host → all. */
function bindCovers(bindHost: string | undefined, address: string): boolean {
  const bind = parseIpAddress(bindHost);
  if (!bindHost || bindHost === "0.0.0.0" || bindHost === "::" || bindHost === "::0" || bind === null) return true;
  const own = parseIpAddress(address);
  return own !== null && own.family === bind.family && own.text === bind.text;
}

/**
 * Cached provider of the non-internal interface addresses the server's bind
 * host covers. A wildcard (or non-IP host name) covers all of them; a specific
 * address covers only itself (so a loopback bind covers none). Cached 30 s so a
 * refusal flood costs no per-request syscall.
 */
export function createLanInterfaceProvider(opts: {
  bindHost?: string;
  read?: () => ReturnType<typeof os.networkInterfaces>;
  now?: () => number;
}): () => LanInterface[] {
  const read = opts.read ?? os.networkInterfaces;
  const now = opts.now ?? Date.now;
  let cached: LanInterface[] = [];
  let at = Number.NEGATIVE_INFINITY;
  return () => {
    if (now() - at < LAN_INTERFACE_TTL_MS) return cached;
    cached = Object.values(read())
      .flatMap((addrs) => addrs ?? [])
      .filter((info) => !info.internal && bindCovers(opts.bindHost, info.address))
      .map((info) => ({ address: info.address, netmask: info.netmask }));
    at = now();
    return cached;
  };
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
