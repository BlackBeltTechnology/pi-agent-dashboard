/**
 * `/live/:id/*` reverse proxy under a capability path — against a REAL upstream.
 *
 *  E25  forwarding: upstream path + Referer lose `/~c/<t>`; redirects stay inside
 *       the capability prefix; `Referrer-Policy: no-referrer` only when the app set
 *       none; no log line carries the token.
 *  E26  dashboard credentials never reach the preview upstream (HTTP + WS), and an
 *       upstream cannot plant a `pi_dash_*` cookie.
 *  X1   upstream down → same error status as a plain `/live/<id>/` request; token
 *       absent from anything logged.
 *
 * See change: retire-trusted-networks-bypass (D5; test-plan E25, E26, X1).
 */
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNetworkGuardHook, type GuardDenialLogEntry } from "../auth/localhost-guard.js";
import { createLiveCapabilityHook, LiveCapabilityStore } from "../live-server/live-capability.js";
import type { LiveServerManager } from "../live-server/live-server-manager.js";
import { handleLiveServerUpgrade, registerLiveServerProxy } from "../live-server/live-server-proxy.js";

const DEVICE_BEARER = "pi-device-bearer-token";
const APP_TOKEN = "app-own-token";
const isDeviceBearer = (t: string) => t === DEVICE_BEARER;
const REMOTE = "203.0.113.5";

interface Seen {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
}

/** Real upstream: echoes the request as JSON; `/redir`, `/policy`, `/cookies` shape the response. */
class Upstream {
  readonly server: http.Server;
  readonly upgrades: Seen[] = [];
  private readonly sockets = new Set<Socket>();
  port = 0;

  constructor() {
    this.server = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://x");
      const seen: Seen = { method: req.method, url: req.url, headers: req.headers };
      if (u.pathname === "/redir") {
        res.writeHead(302, { location: u.searchParams.get("to") ?? "/" });
        return res.end();
      }
      const extra: Record<string, string | string[]> = {};
      if (u.pathname === "/policy") extra["referrer-policy"] = u.searchParams.get("v") ?? "origin";
      if (u.pathname === "/cookies") {
        extra["set-cookie"] = u.searchParams.get("only") === "dash"
          ? ["pi_dash_token=x; Path=/"]
          : ["pi_dash_token=x; Path=/", "myapp_session=y; Path=/", "PI_DASH_DEVICE=z; Path=/"];
      }
      res.writeHead(200, { "content-type": "application/json", ...extra });
      res.end(JSON.stringify(seen));
    });
    this.server.on("connection", (s) => {
      this.sockets.add(s);
      s.on("close", () => this.sockets.delete(s));
    });
    // Hand-rolled upgrade: 101 + echo, recording what the proxy forwarded.
    this.server.on("upgrade", (req, socket) => {
      this.upgrades.push({ method: req.method, url: req.url, headers: req.headers });
      socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
      socket.on("data", (d) => socket.write(d));
      socket.on("error", () => {});
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}

function managerFor(port: () => number): LiveServerManager {
  return {
    start: () => ({ ok: false, error: "unused" }),
    get: (id) => (id === "vite-5173" ? { id, label: id, host: "127.0.0.1", port: port() } : undefined),
    list: () => [],
    remove: () => {},
  };
}

/** Capture every console.* argument, to prove the token is never logged. */
function captureConsole() {
  const lines: string[] = [];
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    }),
  );
  return { lines, restore: () => spies.forEach((s) => s.mockRestore()) };
}

describe("live-server proxy under a capability path", () => {
  let upstream: Upstream;
  let app: FastifyInstance;
  let store: LiveCapabilityStore;
  let token: string;
  let prefix: string;
  let denials: GuardDenialLogEntry[];
  let con: ReturnType<typeof captureConsole>;

  beforeEach(async () => {
    upstream = new Upstream();
    await upstream.start();
    store = new LiveCapabilityStore();
    token = store.mint("vite-5173", { kind: "local" }).token;
    prefix = `/live/vite-5173/~c/${token}`;
    denials = [];
    con = captureConsole();
    const manager = managerFor(() => upstream.port);
    app = Fastify({ logger: false });
    app.decorateRequest("isAuthenticated", false);
    // Production order: capability hook first, universal guard after.
    app.addHook("onRequest", createLiveCapabilityHook(store));
    app.addHook("onRequest", createNetworkGuardHook({ trustedNetworks: () => [], logDenial: (e) => denials.push(e) }));
    registerLiveServerProxy(app, manager, { isDeviceBearer });
    await app.ready();
  });

  afterEach(async () => {
    con.restore();
    await app.close();
    await upstream.stop();
  });

  const get = (url: string, headers: Record<string, string> = {}) =>
    app.inject({ method: "GET", url, remoteAddress: REMOTE, headers });
  const echoed = (res: { body: string }): Seen => JSON.parse(res.body);

  describe("E25 — forwarding", () => {
    it("strips `/~c/<t>` from the upstream path (keeps query) and from Referer", async () => {
      const res = await get(`${prefix}/src/main.ts?x=1`, {
        referer: `http://h/live/vite-5173/~c/${token}/page`,
      });
      expect(res.statusCode).toBe(200);
      const seen = echoed(res);
      expect(seen.url).toBe("/src/main.ts?x=1");
      expect(seen.headers.referer).toBe("http://h/live/vite-5173/page");
      expect(JSON.stringify(seen)).not.toContain(token);
    });

    it("`/` under the capability maps to the upstream root", async () => {
      expect(echoed(await get(`${prefix}/`)).url).toBe("/");
    });

    it.each([
      ["/login", "/login"],
      ["./x", "/x"],
    ])("upstream 302 %s → Location inside the capability prefix", async (to, tail) => {
      const res = await get(`${prefix}/redir?to=${encodeURIComponent(to)}`);
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe(`${prefix}${tail}`);
    });

    it("upstream 302 to its own absolute origin → Location inside the capability prefix", async () => {
      const res = await get(`${prefix}/redir?to=${encodeURIComponent(`http://127.0.0.1:${upstream.port}/y?q=1`)}`);
      expect(res.headers.location).toBe(`${prefix}/y?q=1`);
    });

    it("a foreign absolute redirect is left untouched", async () => {
      const res = await get(`${prefix}/redir?to=${encodeURIComponent("https://example.org/z")}`);
      expect(res.headers.location).toBe("https://example.org/z");
    });

    it("`Referrer-Policy: no-referrer` is added when the upstream set none", async () => {
      expect((await get(`${prefix}/x`)).headers["referrer-policy"]).toBe("no-referrer");
    });

    it("an upstream-set Referrer-Policy is kept as-is", async () => {
      const res = await get(`${prefix}/policy?v=same-origin`);
      expect(res.headers["referrer-policy"]).toBe("same-origin");
    });

    it("a plain (non-capability) request gets no injected Referrer-Policy and plain-prefix redirects", async () => {
      // No capability: admit through a genuinely-local peer.
      const plain = await app.inject({ method: "GET", url: "/live/vite-5173/x", remoteAddress: "127.0.0.1" });
      expect(plain.statusCode).toBe(200);
      expect(plain.headers["referrer-policy"]).toBeUndefined();
      const redir = await app.inject({
        method: "GET",
        url: `/live/vite-5173/redir?to=${encodeURIComponent("/login")}`,
        remoteAddress: "127.0.0.1",
      });
      expect(redir.headers.location).toBe("/live/vite-5173/login");
    });

    it("no console line carries the token across the whole forwarding flow", async () => {
      await get(`${prefix}/src/main.ts`, { referer: `http://h${prefix}/page` });
      await get(`${prefix}/redir?to=%2Flogin`);
      expect(con.lines.join("\n")).not.toContain(token);
    });

    it("a refused capability-looking request logs the REDACTED path (guard sink)", async () => {
      const bad = "B".repeat(43);
      const res = await get(`/live/vite-5173/~c/${bad}/src/main.ts`);
      expect(res.statusCode).toBe(403);
      expect(denials).toHaveLength(1);
      expect(denials[0].path).toContain("/~c/<redacted>");
      expect(JSON.stringify(denials[0])).not.toContain(bad);
    });

    it("the default console sink also redacts (even for a token that WAS valid but expired)", async () => {
      const guarded = Fastify({ logger: false });
      guarded.addHook("onRequest", createNetworkGuardHook({ trustedNetworks: () => [] }));
      guarded.all("/live/:id/*", async () => ({ ok: true }));
      await guarded.ready();
      const gone = new LiveCapabilityStore();
      const { token: t2 } = gone.mint("vite-5173", { kind: "local" });
      gone.revokeByTarget("vite-5173");
      const res = await guarded.inject({ method: "GET", url: `/live/vite-5173/~c/${t2}/x`, remoteAddress: REMOTE });
      expect(res.statusCode).toBe(403);
      const text = con.lines.join("\n");
      expect(text).toContain("[network-guard] denied");
      expect(text).toContain("/~c/<redacted>");
      expect(text).not.toContain(t2);
      await guarded.close();
    });
  });

  describe("E26 — dashboard credentials never reach the upstream (HTTP)", () => {
    it.each([`${"/live/vite-5173/~c/@/"}x`, "/live/vite-5173/x"])("Cookie filtering via %s", async (tpl) => {
      const url = tpl.replace("@", token);
      const remoteAddress = url.includes("~c") ? REMOTE : "127.0.0.1";
      const mixed = await app.inject({
        method: "GET",
        url,
        remoteAddress,
        headers: { cookie: "pi_dash_token=a; pi_dash_device=b; myapp_session=c" },
      });
      expect(echoed(mixed).headers.cookie).toBe("myapp_session=c");
      const onlyDash = await app.inject({ method: "GET", url, remoteAddress, headers: { cookie: "pi_dash_token=a" } });
      expect(onlyDash.statusCode).toBe(200);
      expect(echoed(onlyDash).headers).not.toHaveProperty("cookie");
    });

    it("keeps the app's own cookies byte-for-byte, in order", async () => {
      const res = await get(`${prefix}/x`, { cookie: "a=1; pi_dash_local=z; b=2; c=%20x" });
      expect(echoed(res).headers.cookie).toBe("a=1; b=2; c=%20x");
    });

    it("removes a device-bearer Authorization, keeps the app's own", async () => {
      const dev = await get(`${prefix}/x`, { authorization: `Bearer ${DEVICE_BEARER}` });
      expect(echoed(dev).headers).not.toHaveProperty("authorization");
      const app1 = await get(`${prefix}/x`, { authorization: `Bearer ${APP_TOKEN}` });
      expect(echoed(app1).headers.authorization).toBe(`Bearer ${APP_TOKEN}`);
      const basic = await get(`${prefix}/x`, { authorization: "Basic dTpw" });
      expect(echoed(basic).headers.authorization).toBe("Basic dTpw");
    });

    it("without an `isDeviceBearer` dep, Authorization is never stripped", async () => {
      const bare = Fastify({ logger: false });
      bare.addHook("onRequest", createLiveCapabilityHook(store));
      registerLiveServerProxy(bare, managerFor(() => upstream.port));
      await bare.ready();
      const res = await bare.inject({ method: "GET", url: `${prefix}/x`, headers: { authorization: `Bearer ${DEVICE_BEARER}` } });
      expect(echoed(res).headers.authorization).toBe(`Bearer ${DEVICE_BEARER}`);
      await bare.close();
    });

    it("drops upstream `Set-Cookie` with pi_dash_ names; the browser gets only the app's", async () => {
      const res = await get(`${prefix}/cookies`);
      const sc = res.headers["set-cookie"];
      const list = Array.isArray(sc) ? sc : sc ? [sc] : [];
      // `pi_dash_token` and the case-variant `PI_DASH_DEVICE` are both dropped.
      expect(list).toEqual(["myapp_session=y; Path=/"]);
    });

    it("an upstream that only sets a dashboard cookie yields no Set-Cookie at all", async () => {
      const res = await get(`${prefix}/cookies?only=dash`);
      expect(res.headers["set-cookie"]).toBeUndefined();
    });
  });

  describe("E26 — dashboard credentials never reach the upstream (WS upgrade leg)", () => {
    let front: http.Server;
    let frontPort: number;
    const frontSockets = new Set<Socket>();

    beforeEach(async () => {
      const manager = managerFor(() => upstream.port);
      front = http.createServer((_q, r) => r.writeHead(404).end());
      front.on("connection", (s) => {
        frontSockets.add(s);
        s.on("close", () => frontSockets.delete(s));
      });
      front.on("upgrade", (req, socket, head) => {
        const cap = req.url?.startsWith("/live/vite-5173/~c/") ? { capabilityPrefix: prefix } : {};
        handleLiveServerUpgrade(manager, req, socket, head, { isDeviceBearer, ...cap });
      });
      await new Promise<void>((r) => front.listen(0, "127.0.0.1", r));
      frontPort = (front.address() as AddressInfo).port;
    });
    afterEach(async () => {
      for (const s of frontSockets) s.destroy(); // upgraded sockets are detached from the http server
      await new Promise<void>((r) => front.close(() => r()));
    });

    /** Perform an upgrade; resolves with the 101 socket after an echo round-trip. */
    const upgrade = (path: string, headers: Record<string, string>) =>
      new Promise<{ echo: string }>((resolve, reject) => {
        const req = http.request({
          host: "127.0.0.1",
          port: frontPort,
          path,
          headers: { Connection: "Upgrade", Upgrade: "websocket", ...headers },
        });
        req.on("upgrade", (_res, socket) => {
          socket.once("data", (d) => {
            const echo = d.toString();
            socket.destroy();
            resolve({ echo });
          });
          socket.write("ping");
        });
        req.on("response", () => reject(new Error("no upgrade")));
        req.on("error", reject);
        req.end();
      });

    it("forwards upgrade with Cookie reduced, device bearer + capability Referer stripped, path capability-free", async () => {
      const { echo } = await upgrade(`${prefix}/hmr?token=x`, {
        Cookie: "pi_dash_token=a; pi_dash_device=b; myapp_session=c",
        Authorization: `Bearer ${DEVICE_BEARER}`,
        Referer: `http://h${prefix}/page`,
      });
      expect(echo).toBe("ping");
      expect(upstream.upgrades).toHaveLength(1);
      const seen = upstream.upgrades[0];
      expect(seen.url).toBe("/hmr?token=x");
      expect(seen.headers.cookie).toBe("myapp_session=c");
      expect(seen.headers).not.toHaveProperty("authorization");
      expect(seen.headers.referer).toBe("http://h/live/vite-5173/page");
      expect(JSON.stringify(seen)).not.toContain(token);
    });

    it("only-dashboard cookie → no Cookie header; app bearer kept", async () => {
      await upgrade(`${prefix}/hmr`, { Cookie: "pi_dash_token=a", Authorization: `Bearer ${APP_TOKEN}` });
      const seen = upstream.upgrades[0];
      expect(seen.headers).not.toHaveProperty("cookie");
      expect(seen.headers.authorization).toBe(`Bearer ${APP_TOKEN}`);
    });

    it("plain (non-capability) upgrade strips the same credentials", async () => {
      await upgrade("/live/vite-5173/hmr", {
        Cookie: "pi_dash_token=a; myapp_session=c",
        Authorization: `Bearer ${DEVICE_BEARER}`,
      });
      const seen = upstream.upgrades[0];
      expect(seen.url).toBe("/hmr");
      expect(seen.headers.cookie).toBe("myapp_session=c");
      expect(seen.headers).not.toHaveProperty("authorization");
    });
  });
});

describe("X1 — upstream down", () => {
  let app: FastifyInstance;
  let con: ReturnType<typeof captureConsole>;
  let deadPort: number;
  let token: string;

  beforeEach(async () => {
    // Reserve a port, then free it: nothing listens there.
    const tmp = new Upstream();
    await tmp.start();
    deadPort = tmp.port;
    await tmp.stop();
    const store = new LiveCapabilityStore();
    token = store.mint("vite-5173", { kind: "local" }).token;
    con = captureConsole();
    app = Fastify({ logger: false });
    app.decorateRequest("isAuthenticated", false);
    app.addHook("onRequest", createLiveCapabilityHook(store));
    registerLiveServerProxy(app, managerFor(() => deadPort), { isDeviceBearer });
    await app.ready();
  });
  afterEach(async () => {
    con.restore();
    await app.close();
  });

  it("capability request fails with the same status as a plain /live/<id>/ request; token never logged or echoed", async () => {
    const baseline = await app.inject({ method: "GET", url: "/live/vite-5173/", remoteAddress: "127.0.0.1" });
    expect(baseline.statusCode).toBeGreaterThanOrEqual(500);
    const res = await app.inject({ method: "GET", url: `/live/vite-5173/~c/${token}/`, remoteAddress: REMOTE });
    expect(res.statusCode).toBe(baseline.statusCode);
    expect(res.body).not.toContain(token);
    expect(JSON.stringify(res.headers)).not.toContain(token);
    expect(con.lines.join("\n")).not.toContain(token);
  });
});
