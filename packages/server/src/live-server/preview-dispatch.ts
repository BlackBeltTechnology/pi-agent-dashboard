/**
 * Host/listener dispatch for preview origins (D3): preview-shaped Hosts are answered by a second,
 * route-less Fastify instance (`previewApp`) and NEVER enter the dashboard app — no host gate, CORS,
 * cookie auth, SPA shell, `/api`, `/ws` or plugin route runs for them.
 *
 *   http.Server (serverFactory wrapper) ──preview-shaped Host──▶ previewApp.routing(req, res)
 *                                       └─other Host──────────▶ the dashboard Fastify handler
 *   server.on("upgrade") ──first branch──▶ handleUpgrade(req, socket, head)   (ahead of the host gate)
 *
 * The decision is a pure function of the `Host` header and the resolved preview config; it never scans
 * the capability store. Resolution (label → grant) happens inside `previewApp`, where every refusal is
 * the same 403 `host_not_allowed` (no `allowedHosts` hint, no remedy list, no token hint).
 *
 * See change: serve-live-previews-on-capability-origin (D3).
 */

import http from "node:http";
import { isIP } from "node:net";
import type { Duplex } from "node:stream";
import type { TLSSocket } from "node:tls";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import Fastify from "fastify";
import { getResolvedPreviewOrigins } from "../config-snapshot.js";
import type { LiveCapabilityGrant, LiveCapabilityStore } from "./live-capability.js";
import { registerCspReportParsers } from "./live-csp-report.js";
import type { LiveServerManager } from "./live-server-manager.js";
import { createLiveForwarder, type LiveProxyDeps, pipeUpgradeToTarget } from "./live-server-proxy.js";
import {
  canonicalHostOf,
  hashPreviewKey,
  isPreviewShapedOrigin,
  PREVIEW_LABEL_SHAPE,
  type PreviewShapeDeps,
  previewLogHash,
  splitHostHeader,
} from "./preview-origin.js";

/** Why a preview-shaped request was refused. Logs may show it; the HTTP answer is identical for all. */
export type PreviewRefusalReason =
  | "disabled"
  | "malformed-host"
  | "duplicate-host"
  | "not-a-label"
  | "unknown"
  | "expired"
  | "wrong-host"
  | "wrong-port"
  | "no-target";

export interface PreviewDispatchDeps {
  store: Pick<LiveCapabilityStore, "lookupByHost">;
  manager: LiveServerManager;
  /** Credential-stripping / CSP / static-gate wiring shared with the main-origin `/live/:id/*` proxy. */
  proxyDeps?: LiveProxyDeps;
  /** Is the peer genuinely local (loopback AND no forwarding headers)? Tier-1 entries serve only those. */
  isPeerLocal: (request: http.IncomingMessage) => boolean;
  /** Preview-shape inputs; the defaults read the live config snapshot. */
  shape?: PreviewShapeDeps;
  /** Are previews on? Defaults to the resolved config. A disabled config still answers shaped Hosts with 403. */
  enabled?: () => boolean;
  /** Observability hook: one call per refusal (no label: only the closed reason and, when a label-shaped host was seen, `previewLogHash` of it). */
  onRefused?: (reason: PreviewRefusalReason, h?: string) => void;
  /** Observability hook: one call per ADMITTED request (`h` = hash8 of the label; the observer logs the first per entry). */
  onAdmitted?: (h: string, tier: number | string) => void;
}

/** The options Fastify hands a `serverFactory` (the subset the default HTTP/1 server honours). */
export interface DispatchServerOptions {
  http?: http.ServerOptions;
  keepAliveTimeout?: number;
  requestTimeout?: number;
  connectionTimeout?: number;
  maxRequestsPerSocket?: number;
}

export interface PreviewDispatch {
  /** Hand a preview-shaped request to `previewApp`. */
  handleRequest: (request: http.IncomingMessage, response: http.ServerResponse) => void;
  /** First branch of the `upgrade` switch: `true` when the upgrade was a preview one (served or refused). */
  handleUpgrade: (request: http.IncomingMessage, socket: Duplex, head: Buffer) => boolean;
  /** Is this request routed to `previewApp`? Pure function of the `Host` header + resolved config. */
  isPreviewRequest: (request: http.IncomingMessage) => boolean;
  /** Resolves once `previewApp` can route; await before `listen`. */
  ready: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * First branch of the dashboard `upgrade` switch. `true` = the upgrade was preview-shaped and is handled (served,
 * refused, or — with no dispatcher — closed); `false` = not a preview Host, continue to the dashboard gates.
 */
export function routePreviewUpgrade(
  dispatch: PreviewDispatch | undefined,
  request: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
): boolean {
  if (dispatch) return dispatch.handleUpgrade(request, socket, head);
  if (!isPreviewShapedRequest(request)) return false;
  socket.destroy();
  return true;
}

/**
 * `serverFactory` for the dashboard `Fastify({...})`: preview-shaped Hosts go to `previewApp`, everything
 * else to the dashboard handler. `getDispatch` is late-bound because the dashboard Fastify instance is
 * constructed before the capability store the dispatch needs; until it returns one, nothing is preview-routed
 * (the server is not listening yet). Mirrors Fastify's own HTTP/1 server setup.
 */
export function previewServerFactory(getDispatch: () => PreviewDispatch | undefined) {
  return (handler: http.RequestListener, options: DispatchServerOptions): http.Server => {
    const server = http.createServer(options.http ?? {}, (req, res) => {
      const dispatch = getDispatch();
      // The shape test needs no dispatcher: an uninitialised or throwing one fails closed, never to the dashboard.
      if (!(dispatch ? dispatch.isPreviewRequest(req) : isPreviewShapedRequest(req))) return handler(req, res);
      try {
        if (!dispatch) throw new Error("preview dispatcher not initialised");
        dispatch.handleRequest(req, res);
      } catch {
        failClosed(res);
      }
    });
    if (options.keepAliveTimeout !== undefined) server.keepAliveTimeout = options.keepAliveTimeout;
    if (options.requestTimeout !== undefined) server.requestTimeout = options.requestTimeout;
    if (options.connectionTimeout !== undefined) server.setTimeout(options.connectionTimeout);
    if (options.maxRequestsPerSocket !== undefined && options.maxRequestsPerSocket > 0) {
      server.maxRequestsPerSocket = options.maxRequestsPerSocket;
    }
    return server;
  };
}

/** A Host header we cannot parse that still carries a label-shaped run: refused by `previewApp`, never dashboard-routed. */
const MALFORMED_LABEL_HOST = /[a-z2-7]{26}\./i;

const schemeOfRaw = (request: http.IncomingMessage): "http" | "https" =>
  (request.socket as TLSSocket | undefined)?.encrypted ? "https" : "http";

/**
 * Is this request routed to the preview dispatcher? A pure function of the `Host` header and the resolved
 * preview config — it needs neither the capability store nor `previewApp`, so it still answers when the
 * dispatcher failed to initialise (the server then fails CLOSED for these Hosts, never open to the dashboard).
 */
function isPreviewShapedRequest(request: http.IncomingMessage, shape?: PreviewShapeDeps): boolean {
  const host = request.headers.host;
  if (typeof host !== "string") return false;
  const parsed = splitHostHeader(host);
  if (!parsed) return MALFORMED_LABEL_HOST.test(host);
  return isPreviewShapedOrigin(schemeOfRaw(request), parsed.hostname, parsed.port, shape);
}

/** The closed answer for a preview-shaped request the dispatcher could not serve. Never the dashboard. */
function failClosed(res: http.ServerResponse): void {
  try {
    if (!res.headersSent) {
      res.writeHead(503, { "content-type": "text/plain", "cache-control": "no-store", connection: "close" });
      res.end("preview unavailable");
    } else res.destroy();
  } catch {
    res.destroy();
  }
}

/** How many `Host` headers did the client send? (Node keeps only the first in `headers.host`.) */
function hostHeaderCount(request: http.IncomingMessage): number {
  const raw = request.rawHeaders;
  let n = 0;
  for (let i = 0; i < raw.length; i += 2) if (raw[i].length === 4 && raw[i].toLowerCase() === "host") n++;
  return n;
}

export function createPreviewDispatch(deps: PreviewDispatchDeps): PreviewDispatch {
  const enabled = deps.enabled ?? (() => getResolvedPreviewOrigins().enabled);
  const forwarder = createLiveForwarder(deps.manager, deps.proxyDeps);
  const proxyDeps = deps.proxyDeps ?? {};

  const isPreviewRequest = (request: http.IncomingMessage): boolean => isPreviewShapedRequest(request, deps.shape);

  type Resolution = { ok: true; grant: LiveCapabilityGrant; h: string } | { ok: false; reason: PreviewRefusalReason; h?: string };

  /** Label + canonical Host (+ peer locality) → grant. Every refusal is the same on the wire. */
  const resolveGrant = (request: http.IncomingMessage): Resolution => {
    if (hostHeaderCount(request) !== 1) return { ok: false, reason: "duplicate-host" };
    if (!enabled()) return { ok: false, reason: "disabled" };
    const host = request.headers.host;
    const parsed = splitHostHeader(host);
    const scheme = schemeOfRaw(request);
    const canonical = canonicalHostOf(scheme, host);
    if (!parsed || !canonical) return { ok: false, reason: "malformed-host" };
    if (isIP(parsed.hostname) !== 0) return { ok: false, reason: "not-a-label" };
    const label = parsed.hostname.slice(0, parsed.hostname.indexOf("."));
    if (!PREVIEW_LABEL_SHAPE.test(label)) return { ok: false, reason: "not-a-label" };
    const h = previewLogHash(label);
    let found: ReturnType<LiveCapabilityStore["lookupByHost"]>;
    try {
      found = deps.store.lookupByHost(hashPreviewKey(label), canonical, deps.isPeerLocal(request));
    } catch {
      return { ok: false, reason: "unknown", h }; // a failing accessor fails CLOSED: the same opaque 403, never an admit, never a 502
    }
    if (found.ok) {
      deps.onAdmitted?.(h, found.grant.tier ?? "legacy");
      return { ok: true, grant: found.grant, h };
    }
    return { ok: false, reason: found.reason, h };
  };

  const refuse = (reply: FastifyReply, reason: PreviewRefusalReason, h?: string): FastifyReply => {
    deps.onRefused?.(reason, h);
    return reply.code(403).header("cache-control", "no-store").type("application/json").send({ error: "host_not_allowed" });
  };

  const previewApp: FastifyInstance = Fastify({ logger: false });
  previewApp.register(import("@fastify/reply-from"));
  // Any body, any content type: the stream is forwarded untouched.
  previewApp.addContentTypeParser("*", (_req, payload, done) => done(null, payload));
  // CSP reports parse as JSON (64 KiB cap) before the catch-all; the reserved handler is the ONLY consumer.
  if (proxyDeps.reservedHandler) registerCspReportParsers(previewApp);

  // A dead or failing upstream is a bad gateway — not a 403 (that is the refusal) and never a dashboard page.
  previewApp.setErrorHandler((error: { statusCode?: number }, _request, reply) => {
    const status = error.statusCode !== undefined && error.statusCode < 500 ? error.statusCode : error.statusCode === 504 ? 504 : 502;
    return reply.code(status).header("cache-control", "no-store").type("application/json").send({ error: status === 502 ? "bad_gateway" : status === 504 ? "gateway_timeout" : "bad_request" });
  });

  // Resolve the capability BEFORE the body is read: an unknown / expired / wrong-host label is refused without the
  // body ever reaching a content-type parser (the CSP-report JSON parser would otherwise parse up to 64 KiB for
  // a caller that holds no capability). The resolution is reused by the handler: one lookup per request.
  const resolutions = new WeakMap<http.IncomingMessage, Resolution>();
  previewApp.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const resolved = resolveGrant(request.raw);
    resolutions.set(request.raw, resolved);
    if (!resolved.ok) return refuse(reply, resolved.reason, resolved.h);
  });

  // Route-less: every method and path lands here, so nothing of the dashboard's route table can be reached.
  previewApp.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const resolved = resolutions.get(request.raw) ?? resolveGrant(request.raw);
    if (!resolved.ok) return refuse(reply, resolved.reason, resolved.h);
    const { grant } = resolved;
    const subPath = request.raw.url ?? "/";
    if (!subPath.startsWith("/")) return refuse(reply, "malformed-host");
    if (grant.kind === "static") {
      const target = deps.manager.getStatic(grant.targetId);
      if (!target) return refuse(reply, "no-target");
      return forwarder.forwardStatic(request, reply, target, subPath, grant, "");
    }
    const target = deps.manager.get(grant.targetId);
    if (!target) return refuse(reply, "no-target");
    return forwarder.forwardPort(request, reply, target, subPath, grant, "", { rewriteOrigin: true });
  });

  const handleUpgrade = (request: http.IncomingMessage, socket: Duplex, head: Buffer): boolean => {
    if (!isPreviewRequest(request)) return false;
    socket.on("error", () => socket.destroy());
    try {
      serveUpgrade(request, socket, head);
    } catch {
      socket.destroy(); // fail closed: a throwing dispatcher never hands a preview Host to the dashboard switch
    }
    return true;
  };

  const serveUpgrade = (request: http.IncomingMessage, socket: Duplex, head: Buffer): void => {
    const resolved = resolveGrant(request);
    const subPath = request.url ?? "/";
    const target = resolved.ok && resolved.grant.kind === "port" ? deps.manager.get(resolved.grant.targetId) : undefined;
    if (!resolved.ok || !target || !subPath.startsWith("/")) {
      deps.onRefused?.(resolved.ok ? "no-target" : resolved.reason, resolved.h);
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
      return;
    }
    deps.manager.use(target.id);
    pipeUpgradeToTarget(target, subPath, request, socket, head, proxyDeps);
  };

  return {
    handleRequest: (req, res) => previewApp.routing(req, res),
    handleUpgrade,
    isPreviewRequest,
    ready: async () => {
      await previewApp.ready();
    },
    close: () => previewApp.close(),
  };
}
