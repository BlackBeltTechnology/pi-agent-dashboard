/**
 * Shared harness for the tier-3 pool soak / failure / stall tests: a real pool on a free loopback range, a real
 * `LiveCapabilityStore` wired to its `onDelete`, and a real upstream (HTTP, WebSocket-style upgrade, a header stall).
 * See change: serve-live-previews-on-capability-origin (D5; test-plan #P7-#P9, #X11, #X13, #X15).
 */
import fs from "node:fs";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { parsePreviewOrigins, resolvePreviewOrigins } from "@blackbelt-technology/pi-dashboard-shared/preview-origins.js";
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import { type CapabilityDeleteReason, type CapabilityPrincipal, LiveCapabilityStore, principalKeyOf, sessionKeyOf } from "../live-server/live-capability.js";
import type { LiveServerManager } from "../live-server/live-server-manager.js";
import { createPreviewPool, type PreviewPool } from "../live-server/preview-pool.js";
import { registerLiveServerRoutes } from "../routes/live-server-routes.js";

const COOKIE = "session-cookie-value";
export const session = (v = COOKIE): CapabilityPrincipal => ({ kind: "session", tier: "control", sessionKey: sessionKeyOf(v) });
export { sessionKeyOf };

/** A free run of `n` consecutive loopback ports. */
export async function freeRange(n: number): Promise<{ from: number; to: number }> {
  // 21000-30999 stays below Linux's ephemeral range (32768+): the test's own client sockets would otherwise take ports of the pool mid-run.
  for (let base = 21000 + Math.floor(Math.random() * 10000); ; base += n + 1) {
    const servers: net.Server[] = [];
    try {
      for (let i = 0; i < n; i++) {
        const s = net.createServer();
        await new Promise<void>((res, rej) => {
          s.once("error", rej);
          s.listen(base + i, "127.0.0.1", () => res());
        });
        servers.push(s);
      }
      await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
      return { from: base, to: base + n - 1 };
    } catch {
      await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
    }
  }
}

/** Open descriptors of this process (macOS `/dev/fd`, Linux `/proc/self/fd`); the directory handle itself is a constant offset. */
export const fdCount = (): number => fs.readdirSync(fs.existsSync("/proc/self/fd") ? "/proc/self/fd" : "/dev/fd").length;

/** Is nothing listening on `port` (connection refused)? */
export const refused = (port: number): Promise<boolean> =>
  new Promise((r) => {
    const s = net.connect(port, "127.0.0.1");
    s.on("connect", () => {
      s.destroy();
      r(false);
    });
    s.on("error", () => r(true));
  });

interface Upstream {
  port: number;
  sockets: Set<net.Socket>;
  /** Requests that reached the upstream, by path. */
  seen: string[];
  /** The requests held open by `/stall` (their `socket` is the upstream end of the proxied hop). */
  stalled: http.IncomingMessage[];
  close(): Promise<void>;
}

/** A path containing `/stall` never answers; every other path answers `upstream-body`; an upgrade is answered `101` and held open. */
async function startUpstream(): Promise<Upstream> {
  const sockets = new Set<net.Socket>();
  const seen: string[] = [];
  const stalled: http.IncomingMessage[] = [];
  const server = http.createServer((req, res) => {
    seen.push(req.url ?? "");
    if ((req.url ?? "").includes("/stall")) {
      stalled.push(req);
      return; // headers never come
    }
    res.end("upstream-body");
  });
  server.on("upgrade", (_req, socket) => {
    socket.on("end", () => socket.destroy()); // a WebSocket server closes its side when the peer does
    socket.on("error", () => {});
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.once("close", () => sockets.delete(s));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    port: (server.address() as AddressInfo).port,
    sockets,
    seen,
    stalled,
    close: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
  };
}

export interface Harness {
  range: { from: number; to: number };
  pool: PreviewPool;
  store: LiveCapabilityStore;
  manager: LiveServerManager;
  upstream: Upstream;
  logs: string[];
  /** Why each pool entry was deleted, in order. */
  deleted: CapabilityDeleteReason[];
  /** The route's mint, minus HTTP: allocate, store, issue `k`. */
  mint(principal?: CapabilityPrincipal, targetId?: string): Promise<{ ok: true; port: number; origin: string; k: string; tokenId: string } | { ok: false; reason: string }>;
  close(): Promise<void>;
}

export async function createHarness(opts: { n?: number; range?: { from: number; to: number }; bindHost?: string } = {}): Promise<Harness> {
  const range = opts.range ?? (await freeRange(opts.n ?? 4));
  const upstream = await startUpstream();
  const logs: string[] = [];
  const deleted: CapabilityDeleteReason[] = [];
  const manager = {
    get: (id: string) => (id.startsWith("t") ? { id, label: id, host: "127.0.0.1", port: upstream.port } : undefined),
    getStatic: () => undefined,
    has: (id: string) => id.startsWith("t"),
    use: () => {},
    list: () => [],
  } as unknown as LiveServerManager;
  let pool!: PreviewPool;
  const store = new LiveCapabilityStore({
    isTargetLive: () => true,
    onDelete: (e, r) => {
      if (e.tier === 3) deleted.push(r);
      pool.onDelete(e, r);
    },
  });
  pool = createPreviewPool({
    range: () => range,
    bindHost: () => opts.bindHost ?? "127.0.0.1",
    findByPoolPort: (p) => store.findByPoolPort(p),
    revokeByPoolPort: (p, r) => store.revokeByPoolPort(p, r),
    touch: (g) => void store.touch(g.tokenId, g.minterKey),
    manager,
    log: (l) => logs.push(l),
  });
  return {
    range,
    pool,
    store,
    manager,
    upstream,
    logs,
    deleted,
    async mint(principal = session(), targetId = "t1") {
      const a = await pool.allocate(principalKeyOf(principal), "127.0.0.1");
      if (!a.ok) return a;
      const m = store.mint(targetId, principal, { preview: { tier: 3, ancestors: ["http://127.0.0.1:8000"], fixed: { origin: a.origin, originHost: a.originHost, poolPort: a.port } } });
      return { ok: true as const, port: a.port, origin: a.origin, k: pool.issueK(a.port) as string, tokenId: m.tokenId };
    },
    async close() {
      store.close();
      await pool.close();
      await upstream.close();
    },
  };
}

export interface Res {
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
}
/** One request to a pool listener with the fixed Host binding (no keep-alive unless an `agent` is passed). */
export const request = (port: number, path: string, o: { cookie?: string; agent?: http.Agent; timeoutMs?: number } = {}): Promise<Res> =>
  new Promise((resolve, reject) => {
    const headers: Record<string, string> = { host: `127.0.0.1:${port}` };
    if (o.cookie) headers.cookie = o.cookie;
    const r = http.request({ host: "127.0.0.1", port, path, headers, setHost: false, agent: o.agent ?? false, timeout: o.timeoutMs }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    r.on("error", reject);
    r.end();
  });

/** The first-navigation hop; resolves to the cookie header (session + pool cookie) to present afterwards. */
export async function hop(port: number, k: string, session$ = COOKIE): Promise<string> {
  const res = await request(port, `/?k=${k}`, { cookie: `pi_dash_token=${session$}` });
  const sc = ([] as string[]).concat(res.headers["set-cookie"] ?? [])[0] ?? "";
  return `pi_dash_token=${session$}; ${sc.split(";")[0]}`;
}

/** A raw WebSocket-style upgrade through the pool; resolves once the `101` head arrived, keeping the socket open. */
export const openUpgrade = (port: number, cookie: string): Promise<net.Socket> =>
  new Promise((resolve, reject) => {
    const s = net.connect(port, "127.0.0.1", () =>
      s.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nCookie: ${cookie}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: x\r\nSec-WebSocket-Version: 13\r\n\r\n`),
    );
    let buf = "";
    s.on("data", (c) => {
      buf += c.toString();
      if (buf.includes("\r\n\r\n")) {
        s.removeAllListeners("data");
        s.on("data", () => {});
        buf.startsWith("HTTP/1.1 101") ? resolve(s) : reject(new Error(`upgrade refused: ${buf.split("\r\n")[0]}`));
      }
    });
    s.on("error", () => {});
  });

export interface MintRoute {
  app: FastifyInstance;
  /** `POST /api/live-server/<target>/capability` as a login-session principal reaching the dashboard on `host`. */
  mint(sess: string, target: string, host?: string): Promise<LightMyRequestResponse>;
}
/** The real mint route over a pool + store: `ipDnsSuffix` set ⇒ the tier-4 fallback exists, otherwise tier 5 / legacy. */
export async function createMintRoute(d: {
  pool: PreviewPool;
  store: LiveCapabilityStore;
  manager: LiveServerManager;
  range: { from: number; to: number };
  ipDnsSuffix?: string;
  log?: (line: string) => void;
}): Promise<MintRoute> {
  const app = Fastify({ logger: false });
  app.decorateRequest("isAuthenticated", false);
  app.addHook("onRequest", async (r) => {
    const x = r as unknown as Record<string, unknown>;
    x.authVia = "session";
    x.principalTier = "control";
    x.cookies = { pi_dash_token: String(r.headers["x-session"] ?? COOKIE) };
  });
  const resolved = resolvePreviewOrigins(
    parsePreviewOrigins({ enabled: true, portPool: `${d.range.from}-${d.range.to}`, ...(d.ipDnsSuffix ? { ipDnsSuffix: d.ipDnsSuffix } : {}) }).value,
    { port: 8000, piPort: 9999, allowedHosts: [], publicBaseUrls: [], corsOrigins: [] },
  );
  registerLiveServerRoutes(app, d.manager, { networkGuard: async () => undefined, capabilities: d.store, pool: d.pool, previewOrigins: () => resolved, log: d.log ?? (() => {}) });
  await app.ready();
  return {
    app,
    mint: (sess, target, host = "192.168.1.5:8000") =>
      app.inject({
        method: "POST",
        url: `/api/live-server/${target}/capability`,
        remoteAddress: "192.168.1.9",
        headers: { host, origin: `http://${host}`, "x-session": sess },
        payload: { accept: ["origin", "preview"] },
      }),
  };
}
