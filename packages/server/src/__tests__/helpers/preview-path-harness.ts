/**
 * Shared harness of the tier-5 (`/preview/<pid>/`, D8) route-level tests: a real Fastify app wired like production
 * (preview preflight → capability hook → test principals → optional network guard → mint routes → proxy) in front of a
 * real loopback upstream, with a fake clock and revocable principals. Not a test file: vitest does not collect it.
 *
 * See change: serve-live-previews-on-capability-origin (D8; test-plan #E73-#E88, #X16-#X21).
 */
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import net from "node:net";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { COOKIE_NAME } from "../../auth/auth.js";
import { CORS_ALLOWED_METHODS, isCorsOriginAllowed } from "../../auth/cors-origin.js";
import { createNetworkGuardHook } from "../../auth/localhost-guard.js";
import {
  type CapabilityPrincipal,
  createLiveCapabilityHook,
  LiveCapabilityStore,
  principalKeyOf,
  sessionKeyOf,
} from "../../live-server/live-capability.js";
import { liveLog } from "../../live-server/live-log.js";
import type { LiveServerManager } from "../../live-server/live-server-manager.js";
import { registerLiveServerProxy } from "../../live-server/live-server-proxy.js";
import { previewLogHash } from "../../live-server/preview-origin.js";
import { PreviewPathStore } from "../../live-server/preview-path-store.js";
import { createPreviewPreflight } from "../../live-server/preview-preflight.js";
import { registerLiveServerRoutes } from "../../routes/live-server-routes.js";

export const T0 = 1_700_000_000_000;
export const MIN = 60_000;
export const HOUR = 60 * MIN;
const REMOTE = "203.0.113.5";
const PID_RE = /^\/preview\/([A-Za-z0-9_-]{22})\/$/;

export type Who = { kind: "device"; id: string } | { kind: "session"; id: string } | { kind: "local" };
export const dev = (id: string): Who => ({ kind: "device", id });
export const sess = (id: string): Who => ({ kind: "session", id });
export const LOCAL: Who = { kind: "local" };

/** The principal the mint route derives for `who` (`capabilityPrincipalOf`). */
export function principalOf(who: Who): CapabilityPrincipal {
  if (who.kind === "device") return { kind: "device", tier: "control", deviceId: who.id };
  if (who.kind === "session") return { kind: "session", tier: "control", sessionKey: sessionKeyOf(who.id) };
  return { kind: "local" };
}

/** A loopback upstream that records every request and answers the paths the tier-5 tests drive. */
class Upstream {
  readonly seen: Array<{ method?: string; url?: string; headers: http.IncomingHttpHeaders }> = [];
  readonly upgrades: Array<{ url?: string; headers: http.IncomingHttpHeaders }> = [];
  readonly server: http.Server;
  readonly sockets = new Set<Socket>();
  /** `hang`: accept the TCP connection of an upgrade and never answer it. */
  upgradeMode: "accept" | "hang" = "accept";
  port = 0;
  constructor() {
    this.server = http.createServer((req, res) => {
      this.seen.push({ method: req.method, url: req.url, headers: req.headers });
      const url = req.url ?? "";
      const to = req.headers["x-redirect-to"];
      if (typeof to === "string") {
        res.writeHead(302, { location: to });
        return res.end();
      }
      if (url.includes("/refer")) {
        res.writeHead(200, { "referrer-policy": "unsafe-url", "content-type": "text/plain" });
        return res.end("refer");
      }
      if (url.includes("/vary")) {
        res.writeHead(200, { vary: "Accept-Encoding", "content-type": "text/plain" });
        return res.end("vary");
      }
      if (url.includes("/cors")) {
        res.writeHead(200, { "access-control-allow-origin": "*", "access-control-allow-credentials": "true", vary: "Accept-Encoding" });
        return res.end("cors");
      }
      if (url.includes("/reset")) {
        req.socket.destroy();
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    });
    this.server.on("upgrade", (req, socket) => {
      this.upgrades.push({ url: req.url, headers: req.headers });
      if (this.upgradeMode === "hang") return;
      socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    });
    this.server.on("connection", (s) => {
      this.sockets.add(s);
      s.on("close", () => this.sockets.delete(s));
    });
  }
  async start(): Promise<this> {
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }
  async stop(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}

export interface Mint {
  statusCode: number;
  json: {
    success?: boolean;
    tier?: number | string;
    path?: string;
    origin?: string;
    base?: string;
    expiresAt?: number;
    tokenId?: string;
    restartRequired?: boolean;
    policy?: { egress: string; scripts: boolean };
  };
  /** The pid of a tier-5 answer (`/preview/<pid>/`), else `undefined`. */
  pid: string | undefined;
}

export interface HarnessOptions {
  /** Register the universal network guard (trusted networks `[]`, or the given CIDRs). Default: not registered. */
  guard?: { trusted?: string[] } | false;
  /** Register `@fastify/cors` the way `server.ts` does (credentials on, `isCorsOriginAllowed`), after the preview preflight. */
  cors?: boolean;
  upstream?: Upstream;
}

export interface Harness {
  app: FastifyInstance;
  up: Upstream;
  clock: { now: number };
  paths: PreviewPathStore;
  caps: LiveCapabilityStore;
  targets: Map<string, { id: string; label: string; host: string; port: number }>;
  /** Every `[live-preview] …` line (route log sink + the `pid dropped` drop hook). */
  logs: string[];
  /** Principal keys that are no longer live (device unpaired / session ended). */
  revoked: Set<string>;
  /** Bridge sessions that are still connected. */
  bridges: Set<string>;
  exposure: { exposure: "local-only" | "exposed" };
  guardDenials: string[];
  port: () => number;
  addTarget: (id: string, port?: number) => void;
  /** Register a static (document-root) target: a tier-5 mint for it is the legacy shape. */
  addStatic: (id: string) => void;
  revoke: (who: Who) => void;
  mint: (who: Who, id?: string, body?: Record<string, unknown>, extra?: { peer?: string; host?: string }) => Promise<Mint>;
  /** Real HTTP GET (or `method`) at the app, returns status, headers and body. */
  get: (rawPath: string, headers?: Record<string, string>, method?: string) => Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>;
  close: () => Promise<void>;
}

export async function makeHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const up = opts.upstream ?? (await new Upstream().start());
  const clock = { now: T0 };
  const revoked = new Set<string>();
  const bridges = new Set<string>();
  const logs: string[] = [];
  const guardDenials: string[] = [];
  const exposure = { exposure: "exposed" as "local-only" | "exposed" };
  const targets = new Map<string, { id: string; label: string; host: string; port: number }>();
  const addTarget = (id: string, port = up.port) => {
    targets.set(id, { id, label: id, host: "127.0.0.1", port });
  };
  addTarget("vite-5173");
  const statics = new Map<string, { id: string; label: string; root: string }>();
  const manager = {
    get: (id: string) => targets.get(id),
    getStatic: (id: string) => statics.get(id),
    has: (id: string) => targets.has(id),
    getByPort: (port: number) => [...targets.values()].find((t) => t.port === port),
    portRefusal: () => null,
    list: () => [...targets.values()],
    remove: (id: string) => {
      targets.delete(id);
    },
    use: () => {},
    setEvictionListener: () => {},
  } as unknown as LiveServerManager;
  const isPrincipalLive = (p: CapabilityPrincipal) => !revoked.has(principalKeyOf(p));
  const sink = (l: string) => logs.push(l);
  const paths = new PreviewPathStore({
    now: () => clock.now,
    onDrop: (reason, pid) => liveLog(sink, "pid dropped", { reason, h: previewLogHash(pid) }),
    targetIdForPort: (port) => manager.getByPort(port)?.id,
    isTargetLive: (id) => targets.has(id),
    isPrincipalLive,
  });
  const caps = new LiveCapabilityStore({ now: () => clock.now, isTargetLive: (id) => targets.has(id), isPrincipalLive });
  const app = Fastify({ logger: false });
  app.decorateRequest("isAuthenticated", false);
  app.addHook("onRequest", createPreviewPreflight(() => paths));
  if (opts.cors) {
    await app.register(cors, {
      origin: (origin, cb) => cb(null, isCorsOriginAllowed(origin ?? undefined, { configuredOrigins: [], trustedNetworks: [], getTunnelUrl: () => null })),
      credentials: true,
      methods: CORS_ALLOWED_METHODS,
    });
  }
  app.addHook("onRequest", createLiveCapabilityHook(caps, paths));
  // Test principals (production derives these from the admission hooks): `x-test-kind: device|session` + `x-test-id`.
  app.addHook("onRequest", async (req) => {
    const kind = req.headers["x-test-kind"];
    const id = String(req.headers["x-test-id"] ?? "");
    const r = req as unknown as Record<string, unknown>;
    if (kind === "device") {
      r.isAuthenticated = true;
      r.authVia = "device";
      r.principalTier = "control";
      r.principalDeviceId = id;
    } else if (kind === "session") {
      r.isAuthenticated = true;
      r.authVia = "session";
      r.principalTier = "control";
      r.cookies = { [COOKIE_NAME]: id };
    }
  });
  if (opts.guard) {
    app.addHook("onRequest", createNetworkGuardHook({ trustedNetworks: () => opts.guard ? (opts.guard.trusted ?? []) : [], logDenial: (e) => guardDenials.push(e.path ?? "") }));
  }
  registerLiveServerRoutes(app, manager, {
    networkGuard: async () => undefined,
    capabilities: caps,
    previewPaths: paths,
    previewOrigins: () => ({ enabled: true, tiers: [1, 5], issues: [] }),
    exposure: { current: () => ({ exposure: exposure.exposure, epoch: 0 }) } as never,
    log: sink,
  });
  registerLiveServerProxy(app, manager);
  app.get("/api/sessions", async () => ({ ok: true }));
  app.get("/ws", async () => ({ ok: true }));
  app.get("/auth/x", async () => ({ ok: true }));
  await app.listen({ port: 0, host: "127.0.0.1" });
  const port = () => (app.server.address() as AddressInfo).port;

  const get: Harness["get"] = (rawPath, headers = {}, method = "GET") =>
    new Promise((resolve, reject) => {
      const r = http.request({ host: "127.0.0.1", port: port(), path: rawPath, method, headers }, (res) => {
        let body = "";
        res.on("data", (c) => {
          body += c;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      });
      r.on("error", reject);
      r.end();
    });

  const mint: Harness["mint"] = async (who, id = "vite-5173", body = { accept: ["preview"] }, extra = {}) => {
    const res = await app.inject({
      method: "POST",
      url: `/api/live-server/${id}/capability`,
      remoteAddress: extra.peer ?? (who.kind === "local" ? "127.0.0.1" : REMOTE),
      headers: {
        host: extra.host ?? "localhost:8000",
        ...(who.kind === "local" ? {} : { "x-test-kind": who.kind, "x-test-id": who.id }),
      },
      payload: body,
    });
    const json = res.json() as Mint["json"];
    return { statusCode: res.statusCode, json, pid: typeof json.path === "string" ? PID_RE.exec(json.path)?.[1] : undefined };
  };

  return {
    app,
    up,
    clock,
    paths,
    caps,
    targets,
    logs,
    revoked,
    bridges,
    exposure,
    guardDenials,
    port,
    addTarget,
    addStatic: (id) => void statics.set(id, { id, label: id, root: "/tmp" }),
    revoke: (who) => void revoked.add(principalKeyOf(principalOf(who))),
    mint,
    get,
    close: async () => {
      for (const s of up.sockets) s.destroy();
      await app.close();
      if (!opts.upstream) await up.stop();
    },
  };
}

/** Observe the policy a tier-5 response enforces from its CSP (`scripts` = sandbox allows scripts; `open` = no fetch-directive lockdown). */
export function observedPolicy(csp: string): { egress: "open" | "restricted"; scripts: boolean } {
  return { egress: csp.includes("default-src 'none'") ? "restricted" : "open", scripts: csp.includes("allow-scripts") };
}

/** Raw upgrade dial: the first bytes the server answers with (`""` when the socket is destroyed without a reply). */
export function dialUpgrade(port: number, path: string, headers: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1", () => {
      const extra = Object.entries(headers)
        .map(([k, v]) => `${k}: ${v}\r\n`)
        .join("");
      s.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n${extra}Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: x\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    let buf = "";
    s.on("data", (c) => {
      buf += c.toString();
      if (buf.includes("\r\n\r\n")) s.destroy();
    });
    s.on("close", () => resolve(buf));
    s.on("error", () => resolve(buf));
  });
}
