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
import type { FastifyInstance } from "fastify";
import { stripCapabilitySegment } from "./live-capability.js";
import type { LiveServerManager } from "./live-server-manager.js";

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
    const target = manager.get(match[1]);
    if (!target) return null;
    let rest = match[2] || "";
    if (capabilityPrefix && url.startsWith(capabilityPrefix)) rest = url.slice(capabilityPrefix.length);
    const subPath = rest.startsWith("?") ? `/${rest}` : rest.startsWith("/") ? rest : "/";
    return { target, subPath };
  }

  const forward = (request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
    const capabilityPrefix = (request as { liveCapabilityPrefix?: string }).liveCapabilityPrefix;
    const resolved = resolve(request.url, capabilityPrefix);
    if (!resolved) {
      return reply.code(404).send({ error: "live-server target not found" });
    }
    const { target, subPath } = resolved;
    // Redirects stay inside the capability prefix when the request used one.
    const prefix = capabilityPrefix ?? `/live/${target.id}`;
    const host = upstreamHost(target.host);
    reply.from(`http://${host}:${target.port}${subPath}`, {
      rewriteRequestHeaders: (_req, headers) => {
        headers.host = `${host}:${target.port}`;
        // Dashboard credentials never reach the previewed app; its own cookies
        // and bearer pass through. See change: retire-trusted-networks-bypass (D5).
        stripDashboardCredentials(headers as HeaderBag, isDeviceBearer);
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
        const location = headers.location;
        if (typeof location === "string") {
          headers.location = rewriteLocation(location, prefix, host, target.port);
        }
        return headers;
      },
    });
  };

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
  const target = manager.get(match[1]);
  if (!target) {
    socket.destroy();
    return;
  }
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
