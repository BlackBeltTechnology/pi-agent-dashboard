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
import type { LiveServerManager } from "./live-server-manager.js";
import { serveStatic } from "./live-static.js";

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

/**
 * Strip dashboard credentials from headers bound for the preview upstream:
 * every `pi_dash_*` cookie, and an `Authorization` header that verifies as a
 * dashboard device bearer. Everything else is kept (the app's own session).
 */
function stripDashboardCredentials(
  headers: HeaderBag,
  isDeviceBearer: (token: string) => boolean,
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
    if (m && (isDeviceBearer(m[1]) || m[1].startsWith("pi_op_"))) delete headers.authorization;
  }
  return headers;
}

/**
 * Keep an upstream redirect inside the proxied prefix (`/live/<id>` or the
 * capability prefix). A relative or root-relative `Location` is prefixed; an
 * absolute redirect back to the SAME upstream (`http://127.0.0.1:<port>/…`) is
 * rewritten into the prefix so the browser stays on the dashboard origin and the
 * single-port tunnel keeps working. Foreign absolute redirects are untouched.
 */
function rewriteLocation(location: string, prefix: string, host: string, port: number): string {
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
  /** Does this token verify as a dashboard device bearer? Absent ⇒ never strip `Authorization`. */
  isDeviceBearer?: (token: string) => boolean;
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
 * APPEND our CSP (and `Reporting-Endpoints` entry) to the upstream's response headers —
 * never replacing or stripping the upstream's: browsers enforce every header, so the
 * result is the stricter intersection.
 */
function appendCsp(headers: Record<string, unknown>, csp: LiveCspResult): void {
  const upstreamCsp = headers["content-security-policy"];
  const existing = upstreamCsp === undefined ? [] : Array.isArray(upstreamCsp) ? upstreamCsp : [upstreamCsp];
  headers["content-security-policy"] = [...existing, csp.csp];
  if (!csp.reportingEndpoints) return;
  const re = headers["reporting-endpoints"];
  headers["reporting-endpoints"] =
    typeof re === "string" && re.length > 0 ? `${re}, ${csp.reportingEndpoints}` : csp.reportingEndpoints;
}

/** localhost/::1 resolve to 127.0.0.1 for the upstream TCP connect. */
function upstreamHost(host: string): string {
  return host === "::1" ? "::1" : "127.0.0.1";
}

export function registerLiveServerProxy(
  fastify: FastifyInstance,
  manager: LiveServerManager,
  deps: LiveProxyDeps = {},
) {
  const isDeviceBearer = deps.isDeviceBearer ?? (() => false);
  // Register the `@fastify/reply-from` proxy plugin. live-server-proxy is now
  // the SOLE consumer of the `from` decorator — the editor proxy that used to
  // provide it was deleted in change: remove-external-editor-integration, which
  // orphaned this call and produced `reply.from is not a function` on
  // `/live/:id/*`. Owning the dependency here keeps the proxy self-contained.
  // See change: improve-content-editor, fix-live-server-proxy-reply-from.
  fastify.register(import("@fastify/reply-from"));

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
    return buildLiveCsp({ policy: grant.policy, host, scheme: schemeOf(request), prefix, granted });
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
    if (!grant || !capabilityPrefix) return notFoundReply(reply);
    if (isReservedPath(subPath)) return reservedOr404(request, reply, grant, subPath);
    const csp = cspFor(request, grant, capabilityPrefix);
    if (!csp) return notFoundReply(reply);
    manager.use(target.id);
    const extra: Record<string, string> = { "content-security-policy": csp.csp };
    if (csp.reportingEndpoints) extra["reporting-endpoints"] = csp.reportingEndpoints;
    return serveStatic(request, reply, target, subPath, extra, { gate: deps.staticGate ?? (async () => false) });
  };

  const forwardPort = (
    request: FastifyRequest,
    reply: FastifyReply,
    target: LiveServerTarget,
    subPath: string,
    grant: LiveCapabilityGrant | undefined,
    capabilityPrefix: string | undefined,
  ) => {
    if (grant && isReservedPath(subPath)) return reservedOr404(request, reply, grant, subPath);
    const csp = grant && capabilityPrefix ? cspFor(request, grant, capabilityPrefix) : null;
    // A capability response without a buildable CSP would be less isolated than promised.
    if (grant && !csp) return notFoundReply(reply);
    manager.use(target.id);
    // Redirects stay inside the capability prefix when the request used one.
    const prefix = capabilityPrefix ?? `/live/${target.id}`;
    const host = upstreamHost(target.host);
    reply.from(`http://${host}:${target.port}${subPath}`, {
      rewriteRequestHeaders: (_req, headers) => {
        headers.host = `${host}:${target.port}`;
        // Dashboard credentials never reach the previewed app; its own cookies
        // and bearer pass through. See change: retire-trusted-networks-bypass (D5).
        stripDashboardCredentials(headers as HeaderBag, isDeviceBearer);
        // The hop to the loopback upstream is a PROXIED hop: mark it so nothing the
        // upstream does with this request can pass for "genuinely local".
        headers["x-forwarded-for"] = [headers["x-forwarded-for"], request.ip].filter(Boolean).join(", ");
        // A forwarded Referer must not carry the capability token upstream.
        if (typeof headers.referer === "string") headers.referer = stripCapabilitySegment(headers.referer);
        return headers;
      },
      rewriteHeaders: (headers) => {
        // An upstream may not plant or overwrite a dashboard credential.
        const setCookie = filterSetCookie(headers["set-cookie"] as string | string[] | undefined);
        if (setCookie === undefined) delete headers["set-cookie"];
        else headers["set-cookie"] = setCookie;
        // The token is in this page's URL: keep it out of Referer headers the
        // page sends to third parties unless the app set its own policy.
        if (capabilityPrefix && headers["referrer-policy"] === undefined) {
          headers["referrer-policy"] = "no-referrer";
        }
        if (csp) appendCsp(headers, csp);
        const location = headers.location;
        if (typeof location === "string") {
          headers.location = rewriteLocation(location, prefix, host, target.port);
        }
        return headers;
      },
    });
  };

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

  const reservedOr404 = (request: FastifyRequest, reply: FastifyReply, grant: LiveCapabilityGrant, subPath: string) =>
    deps.reservedHandler
      ? deps.reservedHandler(request, reply, { grant, subPath })
      : notFoundReply(reply);

  fastify.all("/live/:id/*", forward);
  fastify.all("/live/:id", forward);
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
  } = {},
) {
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
  const host = upstreamHost(target.host);
  const isDeviceBearer = deps.isDeviceBearer ?? (() => false);

  const upstream = net.connect(target.port, host, () => {
    // Clear the connect-phase timeout once the socket is established; the pipe
    // below owns the socket lifetime thereafter.
    upstream.setTimeout(0);
    // Dashboard credentials never reach the previewed app (same rule as the
    // HTTP path); a forwarded Referer loses any capability segment.
    const forwarded = stripDashboardCredentials({ ...request.headers } as HeaderBag, isDeviceBearer);
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
