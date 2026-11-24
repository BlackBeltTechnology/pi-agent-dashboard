/**
 * Tier 3 — port-pool listeners (D5). One plain-HTTP listener per live capability, bound like the dashboard (`bindHost`), on the
 * lowest free port of `portPool`. Every pool-port request and upgrade must pass, in this order:
 *
 *   0. the FIXED Host binding: only `entry.originHost` (anything else → 403, distinct from the credential 404);
 *   1. the minting principal's session: `sessionKeyOf(pi_dash_token) === entry.principal.sessionKey` (404);
 *   2. a per-capability secret: the one-shot `?k=<secret>` of the first navigation, which is answered with a host-only
 *      `HttpOnly; SameSite=Strict` cookie `pi_dash_pool_<port>` and a redirect to the clean URL; later requests present that cookie (404);
 *   3. an `Origin` check: when present it must equal `entry.origin` (404, upgrades 403).
 *
 * A `Cookie` header repeating `pi_dash_token` or any `pi_dash_pool_*` name counts as missing the credential. The listener never
 * serves a dashboard route: everything that passes is forwarded to the target (credentials stripped by the shared forwarder).
 * The store owns the lifecycle: its `onDelete` hook releases the listener on every deletion path.
 *
 * See change: serve-live-previews-on-capability-origin (D5).
 */
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import type { Duplex } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import Fastify from "fastify";
import { COOKIE_NAME } from "../auth/auth.js";
import { type CapabilityDeleteReason, type LiveCapabilityEntry, type LiveCapabilityGrant, sessionKeyOf } from "./live-capability.js";
import { type LiveLogSink, liveLog } from "./live-log.js";
import type { LiveServerManager } from "./live-server-manager.js";
import { createLiveForwarder, type LiveProxyDeps, pipeUpgradeToTarget } from "./live-server-proxy.js";
import { hashPreviewKey } from "./preview-origin.js";

/** Pool listeners one principal may hold, so two principals cannot exhaust a 100-port pool. */
export const POOL_PRINCIPAL_CAP = 8;
/** `to=` (post-hop redirect) bound. */
const TO_MAX = 2048;
const POOL_COOKIE_PREFIX = "pi_dash_pool_";
const NOT_FOUND = { error: "not_found" };

export interface PreviewPoolDeps {
  /** The resolved `portPool` range, or `undefined` when tier 3 is off (invalid / unset / `enabled:false`). */
  range: () => { from: number; to: number } | undefined;
  bindHost: () => string;
  /** The store's view of the capability bound to a pool port (never touches it). */
  findByPoolPort: (port: number) => LiveCapabilityGrant | null;
  /** Delete the entry bound to a pool port whose listener failed outside the store's control (Q36). */
  revokeByPoolPort: (port: number, reason?: CapabilityDeleteReason) => void;
  /** Extend the idle expiry of the capability behind an ADMITTED request. */
  touch?: (grant: LiveCapabilityGrant) => void;
  manager: LiveServerManager;
  /** Late-bound: the shared proxy deps are built after the routes that need the pool. */
  proxyDeps?: () => LiveProxyDeps | undefined;
  log?: LiveLogSink;
  /** Network interface addresses (tests inject); default `os.networkInterfaces()`. */
  interfaceAddresses?: () => string[];
}

export type PoolAllocation =
  | { ok: true; port: number; origin: string; originHost: string }
  | { ok: false; reason: "disabled" | "principal-cap" | "exhausted" };

export interface PreviewPool {
  /** Bind the lowest free pool port for `hostIp`; the caller stores the capability with the returned binding. */
  allocate(principalKey: string, hostIp: string): Promise<PoolAllocation>;
  /** Can a listener on the bind address answer a request addressed to `hostIp`? (bound IP, or an interface IP under a wildcard bind) */
  canServeHost(hostIp: string): boolean;
  /** A fresh one-shot `k` for the listener on `port` (an unconsumed earlier `k` is invalidated); `null` if there is none. */
  issueK(port: number): string | null;
  /** The store's `onDelete` hook: close the listener of a deleted tier-3 entry. */
  onDelete(entry: Readonly<LiveCapabilityEntry>, reason: CapabilityDeleteReason): void;
  isPoolPort(port: number): boolean;
  /** Every port in the configured range (for `ownPorts`). */
  poolPorts(): number[];
  heldPorts(): number[];
  close(): Promise<void>;
}

interface Listener {
  server: http.Server;
  sockets: Set<Duplex>;
  principalKey: string;
  kHash: string | null;
  cookieHash: string | null;
  bound: boolean;
}

/** `name=value` pairs of a Cookie header, in order. */
function parseCookies(header: string | undefined): [string, string][] {
  if (!header) return [];
  const out: [string, string][] = [];
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out.push([part.slice(0, i).trim(), part.slice(i + 1).trim()]);
  }
  return out;
}

/** Cookie values of `name`, but `null` when the name repeats (a duplicate is treated as a missing credential). */
function singleCookie(cookies: [string, string][], name: string): string | null {
  const hits = cookies.filter(([n]) => n === name);
  return hits.length === 1 ? hits[0][1] : null;
}
const hasDuplicateCredential = (cookies: [string, string][]): boolean => {
  const seen = new Set<string>();
  for (const [n] of cookies) {
    if (n !== COOKIE_NAME && !n.startsWith(POOL_COOKIE_PREFIX)) continue;
    if (seen.has(n)) return true;
    seen.add(n);
  }
  return false;
};

/** `to=`: a single-slash root-relative path with no `\` or control character, ≤ 2048; anything else is `/`. */
export function safeTo(to: string | null): string {
  if (to === null || to.length === 0 || to.length > TO_MAX) return "/";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  if (!/^\/(?!\/)/.test(to) || /[\\\u0000-\u001f\u007f]/.test(to)) return "/";
  return to;
}

const sha = (s: string): string => hashPreviewKey(s);
const eq = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export function createPreviewPool(deps: PreviewPoolDeps): PreviewPool {
  const listeners = new Map<number, Listener>();
  let fwd: ReturnType<typeof createLiveForwarder> | undefined;
  const forwarder = {
    forwardPort: (...a: Parameters<ReturnType<typeof createLiveForwarder>["forwardPort"]>) => (fwd ??= createLiveForwarder(deps.manager, deps.proxyDeps?.())).forwardPort(...a),
    forwardStatic: (...a: Parameters<ReturnType<typeof createLiveForwarder>["forwardStatic"]>) => (fwd ??= createLiveForwarder(deps.manager, deps.proxyDeps?.())).forwardStatic(...a),
  };
  const proxyDeps = (): LiveProxyDeps => deps.proxyDeps?.() ?? {};
  let poolApp: FastifyInstance | undefined;
  let poolReady: PromiseLike<void> | undefined;

  const interfaceIps = (): string[] =>
    deps.interfaceAddresses?.() ??
    Object.values(os.networkInterfaces()).flatMap((l) => (l ?? []).filter((a) => a.family === "IPv4").map((a) => a.address));
  const isWildcard = (h: string): boolean => h === "0.0.0.0" || h === "::" || h === "";

  const canServeHost = (hostIp: string): boolean => {
    const bind = deps.bindHost();
    return isWildcard(bind) ? interfaceIps().includes(hostIp) : bind === hostIp;
  };

  type Admission =
    | { ok: true; port: number; grant: LiveCapabilityGrant; state: Listener; request: http.IncomingMessage }
    | { ok: false; status: 403 | 404 };

  /** Checks 0, 1 and 3 (the Host binding, the minting session, the Origin); check 2 differs for the `?k=` hop. */
  const admit = (raw: http.IncomingMessage): Admission => {
    const port = raw.socket.localPort ?? 0;
    const state = listeners.get(port);
    const grant = state ? deps.findByPoolPort(port) : null;
    if (!state || !grant || !grant.originHost || !grant.origin) return { ok: false, status: 404 };
    const host = raw.headers.host;
    if (typeof host !== "string" || host !== grant.originHost) return { ok: false, status: 403 };
    const cookies = parseCookies(raw.headers.cookie);
    if (hasDuplicateCredential(cookies)) return { ok: false, status: 404 };
    const session = singleCookie(cookies, COOKIE_NAME);
    if (!session || !grant.principal.sessionKey || !eq(sessionKeyOf(session), grant.principal.sessionKey)) return { ok: false, status: 404 };
    const origin = raw.headers.origin;
    if (origin !== undefined && origin !== grant.origin) return { ok: false, status: 404 };
    return { ok: true, port, grant, state, request: raw };
  };

  const hasPoolCookie = (a: Extract<Admission, { ok: true }>): boolean => {
    const v = singleCookie(parseCookies(a.request.headers.cookie), `${POOL_COOKIE_PREFIX}${a.port}`);
    return !!v && !!a.state.cookieHash && eq(sha(v), a.state.cookieHash);
  };

  const reject = (reply: FastifyReply, status: 403 | 404): FastifyReply =>
    reply.code(status).header("cache-control", "no-store").type("application/json").send(status === 403 ? { error: "host_not_allowed" } : NOT_FOUND);

  const buildApp = (): FastifyInstance => {
    const app = Fastify({ logger: false });
    app.register(import("@fastify/reply-from"));
    app.addContentTypeParser("*", (_req, payload, done) => done(null, payload));
    app.setErrorHandler((error: { statusCode?: number }, _request, reply) => {
      const status = error.statusCode !== undefined && error.statusCode < 500 ? error.statusCode : error.statusCode === 504 ? 504 : 502;
      return reply.code(status).header("cache-control", "no-store").type("application/json").send({ error: status === 502 ? "bad_gateway" : status === 504 ? "gateway_timeout" : "bad_request" });
    });
    app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
      const a = admit(request.raw);
      if (!a.ok) return reject(reply, a.status);
      const url = request.raw.url ?? "/";
      if (!url.startsWith("/")) return reject(reply, 404);
      // The first-navigation hop: `GET /?k=<secret>[&to=<path>]`. `k` is consumed whether or not `to` is usable (Q32).
      const q = url.indexOf("?");
      if (request.raw.method === "GET" && (q < 0 ? url : url.slice(0, q)) === "/" && q >= 0) {
        const params = new URLSearchParams(url.slice(q + 1));
        const k = params.get("k");
        if (k !== null) {
          const to = safeTo(params.get("to"));
          if (a.state.kHash && eq(sha(k), a.state.kHash)) {
            a.state.kHash = null;
            const cookie = crypto.randomBytes(32).toString("base64url");
            a.state.cookieHash = sha(cookie);
            return reply
              .code(302)
              .header("cache-control", "no-store")
              .header("set-cookie", `${POOL_COOKIE_PREFIX}${a.port}=${cookie}; HttpOnly; SameSite=Strict; Path=/`)
              .header("location", to)
              .send();
          }
          // A replayed / unknown `k`: with a valid pool cookie it is just a redirect to the clean URL; otherwise 404.
          if (hasPoolCookie(a)) return reply.code(302).header("cache-control", "no-store").header("location", to).send();
          return reject(reply, 404);
        }
      }
      if (!hasPoolCookie(a)) return reject(reply, 404);
      const { grant } = a;
      deps.touch?.(grant);
      if (grant.kind === "static") {
        const target = deps.manager.getStatic(grant.targetId);
        if (!target) return reject(reply, 404);
        return forwarder.forwardStatic(request, reply, target, url, grant, "");
      }
      const target = deps.manager.get(grant.targetId);
      if (!target) return reject(reply, 404);
      return forwarder.forwardPort(request, reply, target, url, grant, "", { rewriteOrigin: true });
    });
    return app;
  };

  const app = (): FastifyInstance => {
    if (!poolApp) {
      poolApp = buildApp();
      poolReady = poolApp.ready().then(() => undefined);
    }
    return poolApp;
  };

  const serveRequest = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    const a = app();
    void Promise.resolve(poolReady).then(
      () => a.routing(req, res),
      () => {
        res.statusCode = 503;
        res.end();
      },
    );
  };

  const serveUpgrade = (req: http.IncomingMessage, socket: Duplex, head: Buffer): void => {
    socket.on("error", () => socket.destroy());
    const a = admit(req);
    const subPath = req.url ?? "/";
    const target = a.ok && a.grant.kind === "port" ? deps.manager.get(a.grant.targetId) : undefined;
    // Upgrades are refused with 403 (never a redirect, never a cookie hop); they need the pool cookie like any request.
    if (!a.ok || !target || !subPath.startsWith("/") || !hasPoolCookie(a)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
      return;
    }
    deps.manager.use(target.id);
    if (a.ok) deps.touch?.(a.grant);
    pipeUpgradeToTarget(target, subPath, req, socket, head, proxyDeps());
  };

  const closeListener = (port: number, reason: string): void => {
    const l = listeners.get(port);
    if (!l) return;
    listeners.delete(port);
    try {
      l.server.close();
    } catch {
      /* already closed */
    }
    for (const s of l.sockets) s.destroy();
    l.sockets.clear();
    liveLog(deps.log, "pool release", { port, reason });
  };

  /** Try to bind `port`; resolves `true` on success, `false` when the port is taken or unbindable. */
  const tryBind = (port: number, state: Listener): Promise<boolean> =>
    new Promise((resolve) => {
      const server = state.server;
      const onError = (): void => {
        server.removeListener("listening", onListening);
        resolve(false);
      };
      const onListening = (): void => {
        server.removeListener("error", onError);
        resolve(true);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      try {
        server.listen({ port, host: deps.bindHost() });
      } catch {
        onError();
      }
    });

  return {
    canServeHost,
    isPoolPort: (port) => {
      const r = deps.range();
      return !!r && port >= r.from && port <= r.to;
    },
    poolPorts: () => {
      const r = deps.range();
      if (!r) return [];
      return Array.from({ length: r.to - r.from + 1 }, (_, i) => r.from + i);
    },
    heldPorts: () => [...listeners.keys()],
    issueK(port) {
      const l = listeners.get(port);
      if (!l || !l.bound) return null;
      const k = crypto.randomBytes(32).toString("base64url");
      l.kHash = sha(k);
      return k;
    },
    async allocate(principalKey, hostIp) {
      const r = deps.range();
      if (!r) return { ok: false, reason: "disabled" };
      if ([...listeners.values()].filter((l) => l.principalKey === principalKey).length >= POOL_PRINCIPAL_CAP) return { ok: false, reason: "principal-cap" };
      for (let port = r.from; port <= r.to; port++) {
        if (listeners.has(port)) continue;
        const server = http.createServer();
        const state: Listener = { server, sockets: new Set(), principalKey, kHash: null, cookieHash: null, bound: false };
        // Claim the port synchronously so a concurrent allocation never picks it.
        listeners.set(port, state);
        server.on("connection", (s) => {
          state.sockets.add(s);
          s.once("close", () => state.sockets.delete(s));
        });
        server.on("request", serveRequest);
        server.on("upgrade", (req, socket, head) => {
          try {
            serveUpgrade(req, socket, head);
          } catch {
            socket.destroy();
          }
        });
        server.on("clientError", (_err, socket) => socket.destroy());
        if (await tryBind(port, state)) {
          state.bound = true;
          const actual = (server.address() as AddressInfo | null)?.port ?? port;
          if (actual !== port) {
            closeListener(port, "listener-error");
            continue;
          }
          // After the bind, a listener that errors or closes outside the store's control deletes its entry (Q36).
          server.on("error", () => {
            if (listeners.get(port) === state) deps.revokeByPoolPort(port, "listener-error");
            closeListener(port, "listener-error");
          });
          server.on("close", () => {
            if (listeners.get(port) === state) {
              deps.revokeByPoolPort(port, "listener-error");
              closeListener(port, "listener-error");
            }
          });
          liveLog(deps.log, "pool bind", { port, host: deps.bindHost() });
          return { ok: true, port, origin: `http://${hostIp}:${port}`, originHost: `${hostIp}:${port}` };
        }
        listeners.delete(port);
        try {
          server.close();
        } catch {
          /* never listened */
        }
      }
      liveLog(deps.log, "pool exhausted", { range: `${r.from}-${r.to}` });
      return { ok: false, reason: "exhausted" };
    },
    onDelete(entry, reason) {
      if (entry.tier === 3 && entry.poolPort !== undefined) closeListener(entry.poolPort, reason);
    },
    async close() {
      for (const port of [...listeners.keys()]) closeListener(port, "shutdown");
      if (poolApp) {
        await poolApp.close();
        poolApp = undefined;
        poolReady = undefined;
      }
    },
  };
}
