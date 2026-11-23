/**
 * POST /api/web/frame-policy — SSRF-hardened framing probe
 * (test-plan E34, X5–X11; change: rich-chat-links, design D12).
 *
 * Real route + real probe + real mutation-origin gate. Only the two outbound
 * seams are stubbed: `lookup` (DNS) and `request`, which redirects the TLS
 * request to a local plain-HTTP stub server (no certificate fixtures exist)
 * while preserving the target `Host`, path, headers and the pinned agent.
 * Pattern: push-webhook-url.test.ts (DNS stub), api-origin-gate.test.ts (gate).
 */
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import net from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMutationOriginGate } from "../auth/mutation-origin-gate.js";
import type { ProbeRequestFn, ResolvedAddress } from "../lib/frame-policy-probe.js";
import { registerFramePolicyRoutes } from "../routes/frame-policy-routes.js";

const PUBLIC_A = "93.184.216.34";
const PORT = 8000;
const TLS_PORT = 8443;
const DASH = `http://127.0.0.1:${PORT}`;
const TUNNEL = "https://own-tunnel.example";
const corsOpts = () => ({ configuredOrigins: [], trustedNetworks: [], getTunnelUrl: () => TUNNEL });

interface Seen {
  host: string;
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
}
type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

let stub: http.Server;
let stubPort = 0;
let seen: Seen[] = [];
let handlers: Map<string, Handler>;
let open = 0;
let peakOpen = 0;
let agents: Array<https.Agent | http.Agent | boolean | undefined> = [];
let app: FastifyInstance;
let lookup: ReturnType<typeof vi.fn<(host: string) => Promise<ResolvedAddress[]>>>;
let logs: string[];
const sockets = new Set<net.Socket>();

const ok: Handler = (_req, res) => {
  res.writeHead(200, {});
  res.end();
};

beforeEach(async () => {
  seen = [];
  agents = [];
  open = 0;
  peakOpen = 0;
  handlers = new Map();
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation(() => {});
  stub = http.createServer((req, res) => {
    const host = String(req.headers.host ?? "");
    seen.push({ host, method: req.method ?? "", url: req.url ?? "", headers: req.headers });
    open++;
    peakOpen = Math.max(peakOpen, open);
    res.on("close", () => open--);
    (handlers.get(host) ?? ok)(req, res);
  });
  stub.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
  stubPort = (stub.address() as AddressInfo).port;
  lookup = vi.fn(async () => [{ address: PUBLIC_A, family: 4 }]);
});

afterEach(async () => {
  for (const s of sockets) s.destroy();
  await new Promise((r) => stub.close(r));
  await app?.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** Redirect the TLS request to the plain stub; keep Host, path, headers; expose the agent. */
const toStub: ProbeRequestFn = (opts, cb) => {
  agents.push(opts.agent);
  return http.request(
    {
      method: opts.method,
      host: "127.0.0.1",
      port: stubPort,
      path: opts.path,
      headers: { ...opts.headers, host: String(opts.host) },
      signal: opts.signal ?? undefined,
    },
    cb,
  );
};

async function mk(extra: { deadlineMs?: number; principal?: (h: http.IncomingHttpHeaders) => string } = {}): Promise<void> {
  app = Fastify({ logger: false });
  app.addHook("onRequest", createMutationOriginGate(corsOpts));
  registerFramePolicyRoutes(app, {
    networkGuard: async () => {},
    corsOpts,
    ownOrigins: () => [TUNNEL],
    ownPorts: () => [PORT, TLS_PORT],
    principalOf: (req) => extra.principal?.(req.headers) ?? "local-operator",
    probe: { lookup, request: toStub, deadlineMs: extra.deadlineMs },
  });
  await app.ready();
}

const call = (origin: unknown, headers: Record<string, string> = {}) =>
  app.inject({
    method: "POST",
    url: "/api/web/frame-policy",
    headers: { origin: DASH, host: `127.0.0.1:${PORT}`, "content-type": "application/json", ...headers },
    payload: JSON.stringify({ origin }),
  });
const verdictOf = async (origin: unknown, headers?: Record<string, string>) =>
  ((await call(origin, headers)).json() as { verdict?: string }).verdict;
const redirectTo = (loc: string, status = 302): Handler => (_req, res) => {
  res.writeHead(status, { location: loc });
  res.end();
};

describe("E34 — host shape and normalization", () => {
  it.each([
    "https://0x7f.0.0.1",
    "https://2130706433",
    "https://intranet",
    "https://wiki.local",
    "https://10-0-0-5.nip.io",
    "https://LOCALHOST.",
    "https://own-tunnel.example",
    "https://pi-dashboard.dev",
    "https://user:p@example.com",
    "https://example.com:8443",
    "http://example.com",
    "https://192.168.1.1",
    "https://[::1]",
    "not a url",
  ])("%s is ineligible with no DNS and no outbound socket", async (origin) => {
    await mk();
    const res = await call(origin);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ verdict: "ineligible" });
    expect(lookup).not.toHaveBeenCalled();
    expect(seen).toHaveLength(0);
  });

  it("a missing or non-string origin is a 400", async () => {
    await mk();
    for (const bad of [undefined, 42, { a: 1 }, "x".repeat(600)]) {
      expect((await call(bad)).statusCode).toBe(400);
    }
    expect(seen).toHaveLength(0);
  });

  it("only the origin is ever probed: a path or query in the body is dropped", async () => {
    await mk();
    expect(await verdictOf("https://example.com/secret/page?token=abc#frag")).toBe("allowed");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "HEAD", url: "/", host: "example.com" });
  });
});

describe("X5 — redirects re-enter the full check", () => {
  it("a 4-origin public chain stops before the 4th connect", async () => {
    await mk();
    handlers.set("a.example.com", redirectTo("https://b.example.com/"));
    handlers.set("b.example.com", redirectTo("https://c.example.com/"));
    handlers.set("c.example.com", redirectTo("https://d.example.com/"));
    expect(await verdictOf("https://a.example.com")).toBe("ineligible");
    expect(seen.map((s) => s.host)).toEqual(["a.example.com", "b.example.com", "c.example.com"]);
  });

  it.each([
    ["a private IP literal", "https://192.168.1.1/"],
    ["plain http", "http://example.com/"],
    ["a dashboard-own single-label host", "https://own-tunnel/"],
    ["the configured tunnel origin", `${TUNNEL}/`],
    ["userinfo", "https://user:p@example.org/"],
    ["a non-443 port", "https://example.org:8443/"],
    ["an internal suffix", "https://wiki.internal/"],
  ])("a redirect to %s is ineligible and never connected", async (_n, target) => {
    await mk();
    handlers.set("a.example.com", redirectTo(target));
    expect(await verdictOf("https://a.example.com")).toBe("ineligible");
    expect(seen.map((s) => s.host)).toEqual(["a.example.com"]);
    expect(seen.every((s) => s.headers.authorization === undefined && s.headers.cookie === undefined)).toBe(true);
  });

  it("a redirect whose target resolves to a private address is ineligible before connect", async () => {
    await mk();
    handlers.set("a.example.com", redirectTo("https://b.example.com/"));
    lookup.mockImplementation(async (h) => [{ address: h === "b.example.com" ? "10.0.0.7" : PUBLIC_A, family: 4 }]);
    expect(await verdictOf("https://a.example.com")).toBe("ineligible");
    expect(seen.map((s) => s.host)).toEqual(["a.example.com"]);
  });

  it.each([
    ["304 without Location", 304],
    ["302 without Location", 302],
  ])("%s is the final response (undetermined)", async (_n, status) => {
    await mk();
    handlers.set("a.example.com", (_req, res) => {
      res.writeHead(status);
      res.end();
    });
    expect(await verdictOf("https://a.example.com")).toBe("undetermined");
    expect(seen).toHaveLength(1);
  });

  it("follows a same-origin redirect and evaluates the final response's headers", async () => {
    await mk();
    handlers.set("a.example.com", (req, res) => {
      if (req.url === "/") {
        res.writeHead(302, { location: "/en/" });
      } else {
        res.writeHead(200, { "x-frame-options": "DENY" });
      }
      res.end();
    });
    expect(await verdictOf("https://a.example.com")).toBe("refused");
    expect(seen.map((s) => s.url)).toEqual(["/", "/en/"]);
  });

  it("an off-origin redirect re-runs the 'self' matching against the final origin", async () => {
    await mk();
    handlers.set("a.example.com", redirectTo("https://b.example.com/x?y=1", 308));
    handlers.set("b.example.com", (_req, res) => {
      res.writeHead(200, { "content-security-policy": "frame-ancestors 'self'" });
      res.end();
    });
    expect(await verdictOf("https://a.example.com")).toBe("refused");
    expect(seen[1]).toMatchObject({ host: "b.example.com", url: "/x?y=1", method: "HEAD" });
  });
});

describe("X6 — DNS", () => {
  it("a lookup failure is ineligible", async () => {
    await mk();
    lookup.mockRejectedValue(new Error("ENOTFOUND"));
    expect(await verdictOf("https://example.com")).toBe("ineligible");
    expect(seen).toHaveLength(0);
  });

  it("an empty answer is ineligible", async () => {
    await mk();
    lookup.mockResolvedValue([]);
    expect(await verdictOf("https://example.com")).toBe("ineligible");
  });

  it("one private record among public ones is ineligible", async () => {
    await mk();
    lookup.mockResolvedValue([
      { address: PUBLIC_A, family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]);
    expect(await verdictOf("https://example.com")).toBe("ineligible");
    expect(seen).toHaveLength(0);
  });

  it("connects to the first vetted address only (rebinding): lookup once per hop, pinned", async () => {
    await mk();
    lookup
      .mockResolvedValueOnce([{ address: PUBLIC_A, family: 4 }])
      .mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    expect(await verdictOf("https://example.com")).toBe("allowed");
    expect(lookup).toHaveBeenCalledTimes(1);
    const agent = agents[0] as https.Agent & { options: { lookup: Function } };
    expect(agent).toBeInstanceOf(https.Agent);
    // The socket-level resolver the dedicated agent hands to net.connect: both call shapes.
    const asList = await new Promise((r) => agent.options.lookup("example.com", { all: true }, (_e: unknown, a: unknown) => r(a)));
    const asOne = await new Promise((r) => agent.options.lookup("example.com", {}, (_e: unknown, a: unknown, f: unknown) => r([a, f])));
    expect(asList).toEqual([{ address: PUBLIC_A, family: 4 }]);
    expect(asOne).toEqual([PUBLIC_A, 4]);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("a public IP literal is vetted without DNS; a private one never connects", async () => {
    await mk();
    expect(await verdictOf("https://8.8.8.8")).toBe("allowed");
    expect(lookup).not.toHaveBeenCalled();
    expect(await verdictOf("https://[2606:4700::1111]")).toBe("allowed");
  });
});

describe("X7 — slow and unsupported origins", () => {
  it("an origin that stalls after connect is undetermined at the deadline", async () => {
    await mk({ deadlineMs: 250 });
    handlers.set("slow.example.com", () => {});
    const t = Date.now();
    expect(await verdictOf("https://slow.example.com")).toBe("undetermined");
    expect(Date.now() - t).toBeLessThan(1500);
  });

  it("a deadline during DNS (nothing vetted yet) is ineligible", async () => {
    await mk({ deadlineMs: 150 });
    lookup.mockImplementation(() => new Promise(() => {}));
    expect(await verdictOf("https://example.com")).toBe("ineligible");
    expect(seen).toHaveLength(0);
  });

  it.each([405, 501])("a %i answer to HEAD is undetermined and never retried as GET", async (status) => {
    await mk();
    handlers.set("nohead.example.com", (_req, res) => {
      res.writeHead(status);
      res.end();
    });
    expect(await verdictOf("https://nohead.example.com")).toBe("undetermined");
    expect(seen.map((s) => s.method)).toEqual(["HEAD"]);
  });

  it("a reset after connect is undetermined", async () => {
    await mk();
    handlers.set("reset.example.com", (req) => req.socket.destroy());
    expect(await verdictOf("https://reset.example.com")).toBe("undetermined");
  });

  it("the production deadline is 5 s", async () => {
    const { PROBE_DEADLINE_MS } = await import("../lib/frame-policy-probe.js");
    expect(PROBE_DEADLINE_MS).toBe(5000);
  });
});

describe("X8 — request gating", () => {
  it("a request without Origin is a 400 with no outbound request", async () => {
    await mk();
    const res = await app.inject({
      method: "POST",
      url: "/api/web/frame-policy",
      headers: { host: `127.0.0.1:${PORT}`, "content-type": "application/json" },
      payload: JSON.stringify({ origin: "https://example.com" }),
    });
    expect(res.statusCode).toBe(400);
    expect(seen).toHaveLength(0);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("a hostile Origin is refused by the mutation-origin gate", async () => {
    await mk();
    const res = await call("https://example.com", { origin: "https://evil.example" });
    expect(res.statusCode).toBe(403);
    expect(seen).toHaveLength(0);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("a loopback Origin on a port that is not the server's is a 400", async () => {
    await mk();
    const res = await call("https://example.com", { origin: "http://127.0.0.1:9999" });
    expect(res.statusCode).toBe(400);
    expect(seen).toHaveLength(0);
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`, `http://[::1]:${PORT}`, `https://localhost:${TLS_PORT}`, TUNNEL])(
    "own Origin %s proceeds",
    async (origin) => {
      await mk();
      const res = await call("https://example.com", { origin });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ verdict: "allowed" });
    },
  );

  it("the dashboard Origin is the verdict-matching origin", async () => {
    await mk();
    handlers.set("fa.example.com", (_req, res) => {
      res.writeHead(200, { "content-security-policy": `frame-ancestors ${TUNNEL}` });
      res.end();
    });
    expect(await verdictOf("https://fa.example.com", { origin: TUNNEL })).toBe("allowed");
    expect(await verdictOf("https://fa.example.com", { origin: DASH })).toBe("refused");
  });

  it("GET is not a route", async () => {
    await mk();
    const res = await app.inject({ method: "GET", url: "/api/web/frame-policy", headers: { host: `127.0.0.1:${PORT}` } });
    expect([404, 405]).toContain(res.statusCode);
    expect(seen).toHaveLength(0);
  });
});

describe("X9 — limits and cache", () => {
  it("the 31st request in a minute from one principal is a 429 with no sockets", async () => {
    await mk();
    for (let i = 0; i < 30; i++) expect((await call("https://intranet")).statusCode).toBe(200);
    const res = await call("https://example.com");
    expect(res.statusCode).toBe(429);
    expect(seen).toHaveLength(0);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("another principal has its own budget", async () => {
    await mk({ principal: (h) => String(h["x-principal"] ?? "p") });
    for (let i = 0; i < 30; i++) await call("https://intranet", { "x-principal": "one" });
    expect((await call("https://intranet", { "x-principal": "one" })).statusCode).toBe(429);
    expect((await call("https://intranet", { "x-principal": "two" })).statusCode).toBe(200);
  });

  it("never opens a 9th concurrent probe socket", async () => {
    await mk({ deadlineMs: 600 });
    for (let i = 0; i < 9; i++) handlers.set(`h${i}.example.com`, () => {});
    const results = await Promise.all(Array.from({ length: 9 }, (_, i) => call(`https://h${i}.example.com`)));
    expect(peakOpen).toBeLessThanOrEqual(8);
    expect(results.filter((r) => r.statusCode === 503)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(8);
  });

  it("the same principal probing the same origin twice makes one outbound request; another principal its own", async () => {
    await mk({ principal: (h) => String(h["x-principal"] ?? "p") });
    expect(await verdictOf("https://example.com", { "x-principal": "one" })).toBe("allowed");
    expect(await verdictOf("https://example.com", { "x-principal": "one" })).toBe("allowed");
    expect(seen).toHaveLength(1);
    expect(await verdictOf("https://example.com", { "x-principal": "two" })).toBe("allowed");
    expect(seen).toHaveLength(2);
  });

  it("the cache is keyed by the dashboard origin too", async () => {
    await mk();
    await verdictOf("https://example.com", { origin: DASH });
    await verdictOf("https://example.com", { origin: TUNNEL });
    expect(seen).toHaveLength(2);
  });

  it("an undetermined verdict is not cached (a retry probes again)", async () => {
    await mk();
    handlers.set("nohead.example.com", (_req, res) => {
      res.writeHead(405);
      res.end();
    });
    await verdictOf("https://nohead.example.com");
    await verdictOf("https://nohead.example.com");
    expect(seen).toHaveLength(2);
  });
});

describe("X10 — no content or secrets leak", () => {
  it("sends a bare HEAD to / and answers with a verdict only", async () => {
    await mk();
    handlers.set("leaky.example.com", (_req, res) => {
      res.writeHead(200, { "set-cookie": "sid=1", "x-secret": "s" });
      res.end("secret");
    });
    const res = await call("https://leaky.example.com", { cookie: "pi_session=abc", authorization: "Bearer tok" });
    expect(Object.keys(res.json())).toEqual(["verdict"]);
    expect(res.body).not.toMatch(/secret|sid=1/);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe("HEAD");
    expect(seen[0].url).toBe("/");
    expect(seen[0].headers.cookie).toBeUndefined();
    expect(seen[0].headers.authorization).toBeUndefined();
    expect(seen[0].headers.origin).toBeUndefined();
    expect(seen[0].headers.referer).toBeUndefined();
    expect(String(seen[0].headers["user-agent"])).toMatch(/^pi-dashboard/);
  });

  it("logs the host for allowed but only a hash for ineligible, never a path or query", async () => {
    await mk();
    await call("https://intranet/secret?token=abc");
    await call("https://example.com/private/page?x=1");
    const probeLogs = logs.filter((l) => l.includes("frame-policy"));
    expect(probeLogs).toHaveLength(2);
    const [inel, allowed] = probeLogs;
    expect(inel).toContain("ineligible");
    expect(inel).not.toContain("intranet");
    expect(inel).toMatch(/hostHash=[0-9a-f]{8,}/);
    expect(allowed).toContain("host=example.com");
    expect(probeLogs.join("\n")).not.toMatch(/secret|token|private|page|https?:\/\//);
  });
});

describe("X11 — no proxy", () => {
  it("never reads proxy environment variables: dedicated agent, proxy socket never opened", async () => {
    let proxyHits = 0;
    const proxy = net.createServer((s) => {
      proxyHits++;
      s.destroy();
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    const pPort = (proxy.address() as AddressInfo).port;
    vi.stubEnv("HTTPS_PROXY", `http://127.0.0.1:${pPort}`);
    vi.stubEnv("https_proxy", `http://127.0.0.1:${pPort}`);
    vi.stubEnv("NODE_USE_ENV_PROXY", "1");
    try {
      await mk();
      expect(await verdictOf("https://example.com")).toBe("allowed");
      expect(seen).toHaveLength(1);
      const agent = agents[0];
      expect(agent).toBeInstanceOf(https.Agent);
      expect(agent).not.toBe(https.globalAgent);
      expect((agent as { options: { proxyEnv?: unknown } }).options.proxyEnv).toBeUndefined();
      expect(proxyHits).toBe(0);
    } finally {
      await new Promise((r) => proxy.close(r));
    }
  });
});
