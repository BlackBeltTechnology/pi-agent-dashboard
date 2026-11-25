/**
 * Reverse proxy for live-server-preview targets, on the MAIN origin at
 * `/live/:id/*` (mirrors `editor-proxy`'s `/editor/:id/*`). Same-origin path
 * proxy so it survives the single-port remote tunnel (zrok). The client frames
 * it with `sandbox="allow-scripts allow-forms allow-popups allow-downloads"`
 * and NO `allow-same-origin` (opaque origin, D7), so the embedded app cannot
 * read the dashboard token or call its APIs.
 *
 * The proxy ONLY forwards to targets the manager already validated as loopback
 * (SSRF gate lives in `validateLiveTarget`); an unregistered id → 404.
 *
 * See change: improve-content-editor (live-server-preview §6).
 */
import net from "node:net";
import type { LiveServerTarget, StaticTarget } from "@blackbelt-technology/pi-dashboard-shared/live-server.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isBrowserOriginated } from "./live-browser-gate.js";
import { type LiveCapabilityGrant, stripCapabilitySegment } from "./live-capability.js";
import { buildLiveCsp, type LiveCspResult } from "./live-csp.js";
import { registerCspReportParsers } from "./live-csp-report.js";
import type { LiveServerManager } from "./live-server-manager.js";
import { serveStatic } from "./live-static.js";
import { parsePreviewPath } from "./preview-path.js";

/** Dashboard cookie namespace (`pi_dash_token`, `pi_dash_device`, `pi_dash_local`, …). */
const DASHBOARD_COOKIE_PREFIX = "pi_dash_";

/**
 * Remove every dashboard cookie from a `Cookie` header value. Returns `undefined`
 * when nothing remains (the header is then dropped), otherwise the remaining
 * pairs byte-for-byte so the previewed app keeps its own session.
 */
function stripDashboardCookies(cookie: string): string | undefined {
  const kept = cookie
    .split(";")
    .map((pair) => pair.trim())
    .filter((pair) => pair.length > 0 && !pair.toLowerCase().startsWith(DASHBOARD_COOKIE_PREFIX));
  return kept.length > 0 ? kept.join("; ") : undefined;
}

/** Drop upstream `Set-Cookie` lines that name a dashboard cookie (no planting/overwriting). */
function filterSetCookie(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const list = Array.isArray(value) ? value : [value];
  const kept = list.filter((line) => !line.trim().toLowerCase().startsWith(DASHBOARD_COOKIE_PREFIX));
  return kept.length === 0 ? undefined : kept;
}

/** A request/upgrade header bag the credential stripper edits in place. */
type HeaderBag = Record<string, unknown>;

/** The request shape the channel classifier reads (`socket.encrypted` + headers). */
type ProxyRequestLike = Pick<import("node:http").IncomingMessage, "socket" | "headers">;
type DeviceBearerCheck = (token: string, req: ProxyRequestLike | undefined) => boolean;

/**
 * Strip dashboard credentials from headers bound for the preview upstream:
 * every `pi_dash_*` cookie, and an `Authorization` header that verifies as a
 * dashboard device bearer. Everything else is kept (the app's own session).
 */
function stripDashboardCredentials(
  headers: HeaderBag,
  isDeviceBearer: DeviceBearerCheck,
  req: ProxyRequestLike | undefined,
  isKnownBearer: (token: string) => boolean,
): HeaderBag {
  const cookie = headers.cookie;
  if (typeof cookie === "string") {
    const remaining = stripDashboardCookies(cookie);
    if (remaining === undefined) delete headers.cookie;
    else headers.cookie = remaining;
  }
  const authz = headers.authorization;
  if (typeof authz === "string") {
    const m = /^Bearer\s+(.+)$/i.exec(authz.trim());
    // Device bearers and the host's own operator (`pi_op_`) bearer are dashboard credentials.
    // `isDeviceBearer` judges (and records the channel of) the request; `isKnownBearer` then strips EVERY
    // registry-known bearer, so a refused `pi_tls_` bearer is never forwarded off-hub.
    // See change: prove-vault-bridge-tls (D4).
    if (m && (isDeviceBearer(m[1], req) || isKnownBearer(m[1]) || m[1].startsWith("pi_op_"))) delete headers.authorization;
  }
  return headers;
}

/**
 * Tier 5: the upstream already serves under `prefix`, so a redirect inside it is left as is (never prefixed twice);
 * any other root-absolute redirect, or an absolute one back to the same upstream, is rewritten into the prefix.
 */
function rewriteFullPathLocation(location: string, prefix: string, host: string, port: number): string {
  const intoPrefix = (local: string): string => {
    if (staysInside(local, prefix)) return local;
    const prefixed = `${prefix}${local}`;
    return staysInside(prefixed, prefix) ? prefixed : `${prefix}/`;
  };
  if (location.startsWith("/")) return intoPrefix(location);
  try {
    const u = new URL(location);
    if (u.hostname === host && u.port === String(port)) return intoPrefix(`${u.pathname}${u.search}`);
  } catch {
    /* not an absolute URL — leave as-is */
  }
  return location;
}

/** Merge `Origin` into `Vary` (once): the answer of a tier-5 response depends on the request `Origin`. */
function mergeVaryOrigin(headers: Record<string, unknown>): void {
  const vary = headers.vary;
  const list = (Array.isArray(vary) ? vary.join(",") : typeof vary === "string" ? vary : "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (!list.some((v) => v.toLowerCase() === "origin" || v === "*")) list.push("Origin");
  headers.vary = list.join(", ");
}

/**
 * Tier 5 CORS (P6): only on a VALID `/preview/<pid>/` response to `Origin: null`. Overwrites whatever the upstream said
 * (a single `ACAO: null`, never credentials), and merges `Origin` into `Vary` without duplicating it.
 */
function applyNullCors(headers: Record<string, unknown>): void {
  for (const k of Object.keys(headers)) if (k.toLowerCase().startsWith("access-control-")) delete headers[k];
  headers["access-control-allow-origin"] = "null";
  mergeVaryOrigin(headers);
}

/**
 * Tiers 1-5 carry a secret in the URL (label / pid), so `Referrer-Policy: no-referrer` REPLACES any upstream value
 * there (design D3); the legacy path keeps "only when the app set none".
 */
function applyReferrerPolicy(headers: Record<string, unknown>, grant: LiveCapabilityGrant | undefined, capabilityPrefix: string | undefined): void {
  if (grant && grant.tier !== "legacy") headers["referrer-policy"] = "no-referrer";
  else if (capabilityPrefix && headers["referrer-policy"] === undefined) headers["referrer-policy"] = "no-referrer";
}

/** Tier-5 CORS: `ACAO: null` for an opaque-origin request; `Vary: Origin` is present even where no ACAO is granted. */
function applyTier5Cors(headers: Record<string, unknown>, requestOrigin: string | undefined): void {
  if (requestOrigin === "null") applyNullCors(headers);
  else mergeVaryOrigin(headers);
}

/**
 * Keep an upstream redirect inside the proxied prefix (`/live/<id>` or the
 * capability prefix). A relative or root-relative `Location` is prefixed; an
 * absolute redirect back to the SAME upstream (`http://127.0.0.1:<port>/…`) is
 * rewritten into the prefix so the browser stays on the dashboard origin and the
 * single-port tunnel keeps working. Foreign absolute redirects are untouched.
 */
function rewriteLocation(location: string, prefix: string, host: string, port: number, fullPath = false): string {
  if (fullPath) return rewriteFullPathLocation(location, prefix, host, port);
  const relative = location.startsWith("./") ? `${prefix}/${location.slice(2)}` : location.startsWith("/") ? `${prefix}${location}` : null;
  if (relative !== null) return staysInside(relative, prefix) ? relative : `${prefix}/`;
  try {
    const u = new URL(location);
    if (u.hostname === host && u.port === String(port)) {
      const rewritten = `${prefix}${u.pathname}${u.search}`;
      return staysInside(rewritten, prefix) ? rewritten : `${prefix}/`;
    }
  } catch {
    /* not an absolute URL — leave as-is */
  }
  return location;
}

/**
 * Does `path` still resolve inside `prefix` once a browser applies RFC 3986
 * dot-segment removal (WHATWG `URL` does, including `%2e`)? A redirect that
 * climbs out (`./../x`, `/%2e%2e/api`) must not leave the capability/target prefix.
 */
function staysInside(path: string, prefix: string): boolean {
  try {
    const resolved = new URL(path.replace(/\\/g, "/"), "http://x").pathname;
    return resolved === prefix || resolved.startsWith(`${prefix}/`);
  } catch {
    return false;
  }
}

export interface LiveProxyDeps {
  /**
   * Is this absolute URL an origin the dashboard app itself is served on (host-admitted, dashboard port, not preview-shaped)?
   * Tiers 1-4 never deliver an upstream `Location` / `Refresh` aimed at it (D3(c)). Absent ⇒ no containment.
   * See change: serve-live-previews-on-capability-origin (D3(c), T.F40).
   */
  isDashboardUrl?: (url: URL) => boolean;
  /**
   * Does this token verify as a dashboard device bearer on THIS request's channel? Absent ⇒ never
   * strip `Authorization`. Receives the request so the registry can record a non-proven channel.
   */
  isDeviceBearer?: DeviceBearerCheck;
  /** Is this token ANY bearer the registry knows (valid, expired or refused)? Always stripped. */
  isKnownBearer?: (token: string) => boolean;
  /**
   * The raw file-read gate for a static target's real path, re-run on EVERY static
   * request. Absent ⇒ static targets serve nothing (fail closed).
   */
  staticGate?: (cwd: string, absPath: string) => Promise<boolean>;
  /**
   * Granted egress origins `<G>` for a token's CSP: project grants ∪ the viewer's
   * allow-once set. Absent ⇒ none.
   */
  grantedOrigins?: (grant: LiveCapabilityGrant) => readonly string[];
  /** An HTML document of a static target was served under this token (feeds the lazy origin scan). */
  onStaticHtmlServed?: (grant: LiveCapabilityGrant, realPath: string) => void;
  /**
   * Handler for the reserved `/__pi/…` namespace under a valid capability prefix
   * (CSP reports, …). It is never forwarded upstream and never served from disk;
   * absent ⇒ 404. Return the reply you sent.
   */
  reservedHandler?: (
    request: FastifyRequest,
    reply: FastifyReply,
    ctx: { grant: LiveCapabilityGrant; subPath: string },
  ) => Promise<FastifyReply> | FastifyReply;
  /**
   * Tier 5: a `/preview/<pid>/` response is now in flight. The pid's drop destroys it, so a revoked preview cannot keep an
   * HTTP stream (SSE, long download) open to its dev server (test-plan #P11).
   */
  trackPreviewResponse?: (pid: string, res: import("node:http").ServerResponse) => void;
}

/** `/__pi` as a whole path segment (the reserved namespace under a capability prefix). */
const isReservedPath = (subPath: string): boolean => {
  const q = subPath.search(/[?#]/);
  const p = q >= 0 ? subPath.slice(0, q) : subPath;
  return p === "/__pi" || p.startsWith("/__pi/");
};

/** The scheme the dashboard is reached on, as far as this hop can tell. `http` is the safe default (`http://` matches https too). */
const schemeOf = (request: FastifyRequest): "http" | "https" => (request.protocol === "https" ? "https" : "http");

/**
 * APPEND our CSP to the upstream's response headers —
 * never replacing or stripping the upstream's: browsers enforce every header, so the
 * result is the stricter intersection.
 */
function appendCsp(headers: Record<string, unknown>, csp: LiveCspResult): void {
  const upstreamCsp = headers["content-security-policy"];
  const existing = upstreamCsp === undefined ? [] : Array.isArray(upstreamCsp) ? upstreamCsp : [upstreamCsp];
  headers["content-security-policy"] = [...existing, csp.csp];
}

/** localhost/::1 resolve to 127.0.0.1 for the upstream TCP connect. */
function upstreamHost(host: string): string {
  return host === "::1" ? "::1" : "127.0.0.1";
}

/**
 * A preview-origin request reaches the upstream as if the browser had been talking to it directly:
 * `Origin` (except the opaque `null`) and a same-origin `Referer` are rewritten to the upstream origin.
 */
function rewritePreviewOrigin(headers: HeaderBag, upstreamOrigin: string, previewHost: string | undefined): void {
  if (typeof headers.origin === "string" && headers.origin !== "null") headers.origin = upstreamOrigin;
  if (typeof headers.referer === "string") {
    try {
      const r = new URL(headers.referer);
      if (r.host === previewHost) headers.referer = `${upstreamOrigin}${r.pathname}${r.search}`;
    } catch {
      delete headers.referer;
    }
  }
}

/** `url=<target>` of a `Refresh` header value (`0; url=http://x/`, `5;URL='x'`); `null` when it names none. */
function refreshTarget(value: string): string | null {
  const m = /;\s*url\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;]*))/i.exec(value);
  const raw = (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim();
  return raw === "" ? null : raw;
}

/** The absolute http(s) URL `value` names, or `null` for a relative / non-http / malformed one (those resolve on the preview origin). */
function absoluteHttpUrl(value: string): URL | null {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/**
 * D3(c), tiers 1-4: an upstream must not steer the frame onto the dashboard origin by header. A `Refresh` whose
 * target is a dashboard origin is dropped; such a `Location` is rewritten onto the preview origin (same path + query).
 * JS and `<meta refresh>` navigation are not header-contained: the client guard (D6/D7) handles them.
 */
export function containDashboardRedirects(headers: Record<string, unknown>, previewOrigin: string, isDashboardUrl: (u: URL) => boolean): void {
  const dashboard = (v: string): URL | null => {
    const u = absoluteHttpUrl(v);
    return u && u.origin !== previewOrigin && isDashboardUrl(u) ? u : null;
  };
  if (typeof headers.refresh === "string") {
    const target = refreshTarget(headers.refresh);
    if (target !== null && dashboard(target)) delete headers.refresh;
  }
  if (typeof headers.location === "string") {
    const u = dashboard(headers.location);
    if (u) headers.location = `${previewOrigin}${u.pathname}${u.search}${u.hash}`;
  }
}

/** Options of a forwarded port request that differ between `/live/<id>` and a preview origin. */
export interface ForwardPortOptions {
  /** Preview origin: the browser's `Origin`/`Referer` carry the preview origin, which the upstream must see as itself. */
  rewriteOrigin?: boolean;
  /**
   * Tier 5: `subPath` is relative to `capabilityPrefix` (reserved-path / CSP decisions) but the upstream receives the
   * FULL `<prefix><subPath>` — the site was started under that base (D8) — and a `Location` already inside the
   * prefix is left alone instead of being prefixed again.
   */
  fullPath?: boolean;
  /** Tier 5: a valid response to an opaque `Origin: null` gets `Access-Control-Allow-Origin: null` (no credentials). */
  nullCors?: boolean;
}

/**
 * The target-forwarding core shared by the main-origin `/live/:id/*` proxy and the preview-origin
 * `previewApp` (D3): one CSP/cookie/credential/redirect policy, two entry points. The caller's
 * Fastify instance must have `@fastify/reply-from` registered.
 */
export function createLiveForwarder(manager: LiveServerManager, deps: LiveProxyDeps = {}) {
  const isDeviceBearer = deps.isDeviceBearer ?? (() => false);
  const isKnownBearer = deps.isKnownBearer ?? (() => false);

  /** CSP for a capability response, or `null` (fail closed) when no safe header can be built. */
  function cspFor(request: FastifyRequest, grant: LiveCapabilityGrant, prefix: string): LiveCspResult | null {
    const host = request.headers.host;
    if (typeof host !== "string") return null;
    let granted: readonly string[] = [];
    try {
      granted = deps.grantedOrigins?.(grant) ?? [];
    } catch {
      granted = []; // a failing grant lookup must not widen the policy
    }
    // Tiers 1-4 are origin-bound: the policy comes from the entry, not from the request Host / scheme (D6).
    const bound = grant.tier !== "legacy" && grant.tier !== 5;
    if (bound && grant.origin === undefined) return null; // an origin-bound entry without its origin: fail closed
    return buildLiveCsp({
      policy: grant.policy,
      host,
      scheme: schemeOf(request),
      prefix,
      granted,
      ...(bound ? { origin: grant.origin, ancestors: grant.ancestors } : {}),
    });
  }

  const notFoundReply = (reply: FastifyReply) => reply.code(404).send({ error: "live-server target not found" });

  /** A static target, reachable ONLY through a valid capability, by any caller. */
  const forwardStatic = (
    request: FastifyRequest,
    reply: FastifyReply,
    target: StaticTarget,
    subPath: string,
    grant: LiveCapabilityGrant | undefined,
    capabilityPrefix: string | undefined,
  ) => {
    if (!grant || capabilityPrefix === undefined) return notFoundReply(reply);
    if (isReservedPath(subPath)) return reservedOr404(request, reply, grant, subPath);
    const csp = cspFor(request, grant, capabilityPrefix);
    if (!csp) return notFoundReply(reply);
    manager.use(target.id);
    const extra: Record<string, string> = { "content-security-policy": csp.csp };
    return serveStatic(request, reply, target, subPath, extra, {
      gate: deps.staticGate ?? (async () => false),
      onHtmlServed: (real) => deps.onStaticHtmlServed?.(grant, real),
    });
  };

  const forwardPort = (
    request: FastifyRequest,
    reply: FastifyReply,
    target: LiveServerTarget,
    subPath: string,
    grant: LiveCapabilityGrant | undefined,
    capabilityPrefix: string | undefined,
    opts: ForwardPortOptions = {},
  ) => {
    if (grant && isReservedPath(subPath)) return reservedOr404(request, reply, grant, subPath);
    const csp = grant && capabilityPrefix !== undefined ? cspFor(request, grant, capabilityPrefix) : null;
    // A capability response without a buildable CSP would be less isolated than promised.
    if (grant && !csp) return notFoundReply(reply);
    manager.use(target.id);
    // Redirects stay inside the capability prefix when the request used one.
    const prefix = capabilityPrefix ?? `/live/${target.id}`;
    const host = upstreamHost(target.host);
    const upstreamPath = opts.fullPath && capabilityPrefix !== undefined ? `${capabilityPrefix}${subPath}` : subPath;
    reply.from(`http://${host}:${target.port}${upstreamPath}`, {
      rewriteRequestHeaders: (_req, headers) => {
        headers.host = `${host}:${target.port}`;
        // Dashboard credentials never reach the previewed app; its own cookies
        // and bearer pass through. See change: retire-trusted-networks-bypass (D5).
        stripDashboardCredentials(headers as HeaderBag, isDeviceBearer, request.raw, isKnownBearer);
        // The hop to the loopback upstream is a PROXIED hop: mark it so nothing the
        // upstream does with this request can pass for "genuinely local".
        headers["x-forwarded-for"] = [headers["x-forwarded-for"], request.ip].filter(Boolean).join(", ");
        // A forwarded Referer must not carry the capability token upstream.
        if (typeof headers.referer === "string") headers.referer = stripCapabilitySegment(headers.referer);
        if (opts.rewriteOrigin) rewritePreviewOrigin(headers as HeaderBag, `http://${host}:${target.port}`, request.headers.host);
        return headers;
      },
      rewriteHeaders: (headers) => {
        // An upstream may not plant or overwrite a dashboard credential.
        const setCookie = filterSetCookie(headers["set-cookie"] as string | string[] | undefined);
        if (setCookie === undefined) delete headers["set-cookie"];
        else headers["set-cookie"] = setCookie;
        // The token is in this page's URL: keep it out of Referer headers the page sends to third parties.
        applyReferrerPolicy(headers, grant, capabilityPrefix);
        if (csp) appendCsp(headers, csp);
        if (opts.nullCors) applyTier5Cors(headers, request.headers.origin);
        if (grant && grant.tier !== "legacy" && grant.tier !== 5 && grant.origin !== undefined && deps.isDashboardUrl) {
          containDashboardRedirects(headers, grant.origin, deps.isDashboardUrl);
        }
        const location = headers.location;
        if (typeof location === "string") {
          headers.location = rewriteLocation(location, prefix, host, target.port, opts.fullPath === true);
        }
        return headers;
      },
    });
  };

  const reservedOr404 = (request: FastifyRequest, reply: FastifyReply, grant: LiveCapabilityGrant, subPath: string) =>
    deps.reservedHandler
      ? deps.reservedHandler(request, reply, { grant, subPath })
      : notFoundReply(reply);

  return { forwardStatic, forwardPort, notFoundReply, cspFor, reservedOr404 };
}

export function registerLiveServerProxy(
  fastify: FastifyInstance,
  manager: LiveServerManager,
  deps: LiveProxyDeps = {},
) {
  // Register the `@fastify/reply-from` proxy plugin. live-server-proxy is now
  // the SOLE consumer of the `from` decorator — the editor proxy that used to
  // provide it was deleted in change: remove-external-editor-integration, which
  // orphaned this call and produced `reply.from is not a function` on
  // `/live/:id/*`. Owning the dependency here keeps the proxy self-contained.
  // See change: improve-content-editor, fix-live-server-proxy-reply-from.
  fastify.register(import("@fastify/reply-from"));
  // CSP reports arrive as `application/csp-report` / `application/reports+json`.
  if (deps.reservedHandler) registerCspReportParsers(fastify);

  /**
   * `capabilityPrefix` is set (by the capability hook, only after the token
   * validated) when the request arrived under `/live/<id>/~c/<token>/`: that
   * exact segment is removed from the upstream path and kept in redirects.
   */
  function resolve(url: string, capabilityPrefix?: string) {
    const match = url.match(/^\/live\/([^/?]+)(.*)$/);
    if (!match) return null;
    let rest = match[2] || "";
    if (capabilityPrefix && url.startsWith(capabilityPrefix)) rest = url.slice(capabilityPrefix.length);
    const subPath = rest.startsWith("?") ? `/${rest}` : rest.startsWith("/") ? rest : "/";
    return { id: match[1], subPath };
  }
  const { forwardStatic, forwardPort, notFoundReply } = createLiveForwarder(manager, deps);

  const forward = (request: FastifyRequest, reply: FastifyReply) => {
    const capabilityPrefix = (request as { liveCapabilityPrefix?: string }).liveCapabilityPrefix;
    const grant = (request as { liveCapability?: LiveCapabilityGrant }).liveCapability;
    // A browser-originated request (opaque `Origin: null` / `Sec-Fetch-*`) needs a capability.
    if (!grant && isBrowserOriginated(request.headers as Record<string, unknown>)) return notFoundReply(reply);
    const resolved = resolve(request.url, capabilityPrefix);
    if (!resolved) return notFoundReply(reply);
    const { id, subPath } = resolved;
    const staticTarget = manager.getStatic(id);
    if (staticTarget) return forwardStatic(request, reply, staticTarget, subPath, grant, capabilityPrefix);
    const target = manager.get(id);
    if (!target) return notFoundReply(reply);
    return forwardPort(request, reply, target, subPath, grant, capabilityPrefix);
  };

  fastify.all("/live/:id/*", forward);
  fastify.all("/live/:id", forward);

  /**
   * Tier 5 (D8): `/preview/<pid>[/…]`. The capability hook validated the pid and set `liveCapability`; any request
   * without one (browser-originated or not) is 404, as is a path the raw-path validator refuses.
   */
  const forwardPreview = (request: FastifyRequest, reply: FastifyReply) => {
    const grant = (request as { liveCapability?: LiveCapabilityGrant }).liveCapability;
    const path = parsePreviewPath(request.raw.url);
    if (!grant || grant.tier !== 5 || !path) return notFoundReply(reply);
    const target = manager.get(grant.targetId);
    if (!target) return notFoundReply(reply);
    deps.trackPreviewResponse?.(path.pid, reply.raw);
    return forwardPort(request, reply, target, path.rest, grant, path.prefix, { fullPath: true, nullCors: true });
  };
  // A dead or resetting upstream is a bad gateway (never a dashboard 500), like the preview-origin and pool forwarders.
  const badGateway = (error: { statusCode?: number }, _request: FastifyRequest, reply: FastifyReply) => {
    const status = error.statusCode !== undefined && error.statusCode < 500 ? error.statusCode : error.statusCode === 504 ? 504 : 502;
    return reply.code(status).header("cache-control", "no-store").type("application/json").send({ error: status === 502 ? "bad_gateway" : status === 504 ? "gateway_timeout" : "bad_request" });
  };
  fastify.all("/preview/:pid/*", { errorHandler: badGateway }, forwardPreview);
  fastify.all("/preview/:pid", { errorHandler: badGateway }, forwardPreview);
}

/** Longest upstream 101 head we will buffer before giving up. */
const MAX_HANDSHAKE_BYTES = 16 * 1024;

/**
 * Pipe the upstream's upgrade response to the browser, dropping any
 * `Set-Cookie` that names a dashboard cookie from the 101 head (a previewed app
 * must not plant or overwrite a dashboard credential over the WS handshake
 * either); the frames after the head are piped untouched.
 */
function forwardHandshakeFiltered(upstream: net.Socket, socket: import("node:stream").Duplex): void {
  let buf = Buffer.alloc(0);
  const onData = (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    const end = buf.indexOf("\r\n\r\n");
    if (end < 0) {
      if (buf.length > MAX_HANDSHAKE_BYTES) upstream.destroy();
      return;
    }
    upstream.off("data", onData);
    upstream.setTimeout(0); // the handshake finished: the pipe owns the socket lifetime from here
    const headText = buf.subarray(0, end).toString("latin1");
    const filtered = headText
      .split("\r\n")
      .filter((line) => !/^set-cookie:\s*pi_dash_/i.test(line))
      .join("\r\n");
    socket.write(Buffer.concat([Buffer.from(`${filtered}\r\n\r\n`, "latin1"), buf.subarray(end + 4)]));
    upstream.pipe(socket);
  };
  upstream.on("data", onData);
}

/** WebSocket upgrade forwarding (HMR / dev-server sockets). */
export function handleLiveServerUpgrade(
  manager: LiveServerManager,
  request: import("node:http").IncomingMessage,
  socket: import("node:stream").Duplex,
  head: Buffer,
  deps: LiveProxyDeps & {
    /** `/live/<id>/~c/<token>` when the upgrade was admitted by a validated capability. */
    capabilityPrefix?: string;
    /** Tier 5: the upgrade was admitted by a valid `/preview/<pid>/` capability for this target; the FULL path is forwarded. */
    previewTargetId?: string;
  } = {},
) {
  if (deps.previewTargetId !== undefined) return upgradePreview(manager, request, socket, head, deps, deps.previewTargetId);
  const match = request.url?.match(/^\/live\/([^/?]+)(.*)$/);
  if (!match) {
    socket.destroy();
    return;
  }
  // A browser-originated upgrade (opaque `Origin: null` / `Sec-Fetch-*`) needs a capability.
  if (!deps.capabilityPrefix && isBrowserOriginated(request.headers as Record<string, unknown>)) {
    socket.destroy();
    return;
  }
  const target = manager.get(match[1]);
  if (!target) {
    socket.destroy();
    return;
  }
  manager.use(target.id);
  const capabilityPrefix = deps.capabilityPrefix;
  let rest = match[2] || "";
  if (capabilityPrefix && request.url?.startsWith(capabilityPrefix)) rest = request.url.slice(capabilityPrefix.length);
  const subPath = rest.startsWith("?") ? `/${rest}` : rest.startsWith("/") ? rest : "/";
  pipeUpgradeToTarget(target, subPath, request, socket, head, deps);
}

/**
 * Open the upstream socket for an admitted upgrade and pipe both directions. Shared by the
 * main-origin `/live/<id>` upgrade and the preview-origin upgrade (D3). The browser `Origin` is
 * never forwarded; `Host` is rewritten to the upstream.
 */
export function pipeUpgradeToTarget(
  target: LiveServerTarget,
  subPath: string,
  request: import("node:http").IncomingMessage,
  socket: import("node:stream").Duplex,
  head: Buffer,
  deps: LiveProxyDeps,
) {
  const host = upstreamHost(target.host);
  const isDeviceBearer = deps.isDeviceBearer ?? (() => false);
  const isKnownBearer = deps.isKnownBearer ?? (() => false);

  const upstream = net.connect(target.port, host, () => {
    // The handshake timeout below stays armed until the upstream's 101 head is complete
    // (`forwardHandshakeFiltered` clears it): an upstream that accepts TCP and never answers the upgrade
    // must not hold the socket pair open forever.
    // Dashboard credentials never reach the previewed app (same rule as the
    // HTTP path); a forwarded Referer loses any capability segment.
    const forwarded = stripDashboardCredentials({ ...request.headers } as HeaderBag, isDeviceBearer, request, isKnownBearer);
    // A proxied hop: the upstream must never see this upgrade as genuinely local.
    forwarded["x-forwarded-for"] = [forwarded["x-forwarded-for"], request.socket?.remoteAddress]
      .filter(Boolean)
      .join(", ");
    if (typeof forwarded.referer === "string") forwarded.referer = stripCapabilitySegment(forwarded.referer);
    const headers = Object.entries(forwarded)
      .filter(([k]) => !["host", "origin"].includes(k.toLowerCase()))
      .map(([k, v]) => `${k}: ${v}`)
      .join("\r\n");
    upstream.write(
      `${request.method} ${subPath} HTTP/1.1\r\n` +
        `Host: ${host}:${target.port}\r\n` +
        `${headers}\r\n\r\n`,
    );
    if (head.length > 0) upstream.write(head);
    forwardHandshakeFiltered(upstream, socket);
    socket.pipe(upstream);
  });
  // Bound the connect/upgrade handshake: a target that accepts TCP but never
  // completes the upgrade must not leak an idle socket pair forever.
  upstream.setTimeout(10_000, () => upstream.destroy());
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
  socket.on("close", () => upstream.destroy());
  upstream.on("close", () => socket.destroy());
}

/** Tier 5 upgrade: re-parse the raw path (never trust the caller) and pipe the FULL path to the target. */
function upgradePreview(
  manager: LiveServerManager,
  request: import("node:http").IncomingMessage,
  socket: import("node:stream").Duplex,
  head: Buffer,
  deps: LiveProxyDeps,
  targetId: string,
) {
  const path = parsePreviewPath(request.url);
  const target = path ? manager.get(targetId) : undefined;
  if (!path || !target) {
    socket.destroy();
    return;
  }
  manager.use(target.id);
  pipeUpgradeToTarget(target, request.url as string, request, socket, head, deps);
}
