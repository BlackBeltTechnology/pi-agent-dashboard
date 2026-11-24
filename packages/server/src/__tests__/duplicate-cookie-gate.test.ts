/**
 * Duplicate `pi_dash_*` cookie refusal + self-heal (D10).
 * See change: serve-live-previews-on-capability-origin (D10; test-plan #E106-#E115, #E117, #E118, #E123-#E125, #P13).
 */
import http from "node:http";
import net from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ancestorDomains,
  buildExpiryLines,
  createDuplicateCookieGate,
  DuplicateCookieLog,
  expiryPaths,
  findDuplicateDashboardCookie,
  refuseDuplicateCookieUpgrade,
} from "../auth/duplicate-cookie-gate.js";
import { wantsHtml } from "../auth/host-gate.js";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

const open: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((a) => a.close()));
});

async function mkApp(opts: { tier2?: boolean; log?: DuplicateCookieLog } = {}) {
  const app = Fastify({ logger: false });
  open.push(app);
  const calls: string[] = [];
  // a stand-in for the host gate, registered first
  app.addHook("onRequest", (req, reply, done) => {
    if (req.headers.host === "bad.example") {
      reply.code(403).send({ error: "host_not_allowed" });
      return;
    }
    done();
  });
  app.addHook("onRequest", createDuplicateCookieGate({ tier2: () => opts.tier2 === true, log: opts.log ?? new DuplicateCookieLog(() => {}) }));
  app.addHook("onRequest", (req, _reply, done) => {
    if (req.headers.origin === "http://attacker.example") calls.push("origin-gate");
    done();
  });
  app.all("/*", async (req) => {
    calls.push("handler");
    return { ok: true, url: req.url };
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const port = (app.server.address() as net.AddressInfo).port;
  return { app, port, calls };
}

function req(port: number, o: { path?: string; method?: string; headers?: Record<string, string> }) {
  return new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, path: o.path ?? "/api/sessions", method: o.method ?? "GET", headers: o.headers }, (res) => {
      let body = "";
      res.on("data", (c) => {
        body += c;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    r.on("error", reject);
    r.end();
  });
}

describe("findDuplicateDashboardCookie (E107-E111)", () => {
  it("E108: refusal depends on the NAME only — identical, interleaved and empty values all count", () => {
    expect(findDuplicateDashboardCookie("pi_dash_token=a; pi_dash_token=a")).toEqual({ name: "pi_dash_token", count: 2 });
    expect(findDuplicateDashboardCookie("pi_dash_local=a; x=1; pi_dash_local=b")).toEqual({ name: "pi_dash_local", count: 2 });
    expect(findDuplicateDashboardCookie("pi_dash_token=; pi_dash_token=")).toEqual({ name: "pi_dash_token", count: 2 });
  });
  it("E107: every dashboard name, including unknown suffixes; singles pass", () => {
    for (const n of ["pi_dash_token", "pi_dash_local", "pi_dash_device", "pi_dash_oauth_state", "pi_dash_pool_8101", "pi_dash_zzz"]) {
      expect(findDuplicateDashboardCookie(`${n}=1; ${n}=2`)?.name).toBe(n);
      expect(findDuplicateDashboardCookie(`${n}=1`)).toBeNull();
    }
  });
  it("E109: name boundary is a literal, case-sensitive `pi_dash_` prefix", () => {
    for (const n of ["pi_dash", "xpi_dash_token", "pi-dash_token", "pi_das_token", "theme", "PI_DASH_TOKEN"]) {
      expect(findDuplicateDashboardCookie(`${n}=1; ${n}=2`), n).toBeNull();
    }
    expect(findDuplicateDashboardCookie("pi_dash_=1; pi_dash_=2")?.name).toBe("pi_dash_");
  });
  it("E110: count boundary reports the true count", () => {
    const n = (k: number) => Array.from({ length: k }, (_, i) => `pi_dash_token=${i}`).join("; ");
    expect(findDuplicateDashboardCookie(n(1))).toBeNull();
    expect(findDuplicateDashboardCookie(n(2))?.count).toBe(2);
    expect(findDuplicateDashboardCookie(n(3))?.count).toBe(3);
    expect(findDuplicateDashboardCookie(n(50))?.count).toBe(50);
  });
  it("E111: raw header forms never hide a duplicate and never throw", () => {
    for (const h of [
      "pi_dash_token=a;pi_dash_token=b",
      "pi_dash_token=a; pi_dash_token=b;",
      "pi_dash_token=a;; pi_dash_token=b",
      'pi_dash_token="a"; pi_dash_token="b"',
      "pi_dash_token = a; pi_dash_token = b",
      "pi_dash_token; pi_dash_token",
    ]) {
      expect(findDuplicateDashboardCookie(h)?.name, h).toBe("pi_dash_token");
    }
    expect(findDuplicateDashboardCookie(["pi_dash_token=a", "pi_dash_token=b"])?.name).toBe("pi_dash_token");
    expect(findDuplicateDashboardCookie(undefined)).toBeNull();
    expect(findDuplicateDashboardCookie("")).toBeNull();
  });
});

describe("self-heal expiry set (E114, E115, E117, E118)", () => {
  it("E114: the nine host-only lines of a deep path, no value, no duplicates", () => {
    const lines = buildExpiryLines("pi_dash_token", "/api/sessions/abc/events", "localhost:8000", false);
    expect(lines).toEqual(
      [
        "/",
        "/api",
        "/api/",
        "/api/sessions",
        "/api/sessions/",
        "/api/sessions/abc",
        "/api/sessions/abc/",
        "/api/sessions/abc/events",
        "/auth/",
      ].map((p) => `pi_dash_token=; Max-Age=0; Path=${p}`),
    );
    expect(new Set(lines).size).toBe(lines.length);
  });
  it("E115: roots, query/fragment, doubled slashes", () => {
    expect(expiryPaths("/")).toEqual(["/", "/api/", "/auth/"]);
    expect(expiryPaths("/api/")).toEqual(["/", "/api", "/api/", "/auth/"]);
    expect(expiryPaths("/auth/callback?code=x#f")).toEqual(["/", "/auth", "/auth/", "/auth/callback", "/api/"]);
    expect(expiryPaths("//api//x")).not.toContain("");
    expect(expiryPaths("//api//x").every((p) => p.startsWith("/") && !p.includes("//"))).toBe(true);
    expect(expiryPaths("/a?q=/b").join()).not.toContain("q=");
  });
  it("caps: first 16 segments, at most 64 Set-Cookie lines", () => {
    const deep = `/${Array.from({ length: 40 }, (_, i) => `s${i}`).join("/")}`;
    const hostOnly = buildExpiryLines("pi_dash_token", deep, "a.b.example.com", false);
    expect(hostOnly.length).toBeLessThanOrEqual(64);
    expect(hostOnly.some((l) => l.endsWith("Path=/s0/s1/s2/s3/s4/s5/s6/s7/s8/s9/s10/s11/s12/s13/s14/s15/s16"))).toBe(false);
    expect(hostOnly.some((l) => l.endsWith("Path=/s0/s1/s2/s3/s4/s5/s6/s7/s8/s9/s10/s11/s12/s13/s14/s15"))).toBe(true);
    expect(buildExpiryLines("pi_dash_token", deep, "a.b.example.com", true).length).toBeLessThanOrEqual(64);
  });
  it("E117: Domain= variants only for a hostname Host with >= 2-label ancestors, only while tier 2 is active", () => {
    expect(ancestorDomains("dash.a.example.com")).toEqual(["a.example.com", "example.com"]);
    expect(ancestorDomains("DASH.A.EXAMPLE.COM.:8443")).toEqual(["a.example.com", "example.com"]);
    for (const h of ["dash", "localhost", "[::1]", "192.168.1.5", "example.com", undefined]) expect(ancestorDomains(h), String(h)).toEqual([]);
    const withTier = buildExpiryLines("pi_dash_token", "/", "dash.a.example.com", true);
    expect(withTier).toContain("pi_dash_token=; Max-Age=0; Path=/; Domain=a.example.com");
    expect(withTier).toContain("pi_dash_token=; Max-Age=0; Path=/; Domain=example.com");
    expect(withTier.join()).not.toContain("Domain=com");
    expect(buildExpiryLines("pi_dash_token", "/", "dash.a.example.com", false).join()).not.toContain("Domain=");
    expect(buildExpiryLines("pi_dash_token", "/", "192.168.1.5", true).join()).not.toContain("Domain=");
  });
  it("E118: an attacker-chosen name is inert — no expiry for non-token names, no CR/LF anywhere", () => {
    for (const n of ["pi_dash_<img src=x onerror=1>", "pi_dash_a%0d%0aSet-Cookie:x=1".replace("%0d%0a", "\r\n"), `pi_dash_${"x".repeat(4096)}`]) {
      const lines = buildExpiryLines(n, "/", "localhost", false);
      expect(lines).toEqual([]);
    }
    expect(buildExpiryLines("pi_dash_a%0d%0aSet-Cookie:x=1", "/", "localhost", false).join()).not.toMatch(/[\r\n]/);
  });
});

describe("the hook (E106, E112, E113, E123, E125)", () => {
  it("E106: 400 JSON, no CORS, handler not called; expiry lines in the response", async () => {
    const { port, calls } = await mkApp();
    const r = await req(port, { path: "/api/sessions/abc/events", headers: { cookie: "pi_dash_token=a; pi_dash_token=b", accept: "application/json", origin: "http://localhost:8000" } });
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body)).toEqual({ success: false, error: "duplicate_dashboard_cookie", cookie: "pi_dash_token" });
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
    expect((r.headers["set-cookie"] as string[]).length).toBe(9);
    expect(calls).toEqual([]);
  });
  it("E113: HTML only where the host gate would return HTML for the same Accept (differential)", async () => {
    const { port } = await mkApp();
    for (const accept of ["text/html,application/xhtml+xml", "application/json", undefined, "*/*", "application/json, text/html;q=0.9", "TEXT/HTML", "text/html;q=0", "text/*"]) {
      const r = await req(port, { headers: { cookie: "pi_dash_token=a; pi_dash_token=b", ...(accept ? { accept } : {}) } });
      expect(r.status).toBe(400);
      expect(r.headers["content-type"]?.startsWith("text/html"), String(accept)).toBe(wantsHtml(accept));
    }
  });
  it("E123: host gate first (no cookie expiry); the duplicate gate precedes the origin gates; no ACAO", async () => {
    const { port, calls } = await mkApp();
    const a = await req(port, { headers: { host: "bad.example", cookie: "pi_dash_token=a; pi_dash_token=b" } });
    expect(a.status).toBe(403);
    expect(a.headers["set-cookie"]).toBeUndefined();
    const b = await req(port, { method: "POST", headers: { cookie: "pi_dash_token=a; pi_dash_token=b", origin: "http://attacker.example" } });
    expect(b.status).toBe(400);
    expect(b.headers["access-control-allow-origin"]).toBeUndefined();
    expect(calls).toEqual([]); // neither the origin gate nor the handler ran
  });
  it("E125: no path is exempt (HEAD, static-like, health)", async () => {
    const { port, calls } = await mkApp();
    for (const [m, p] of [["GET", "/api/health"], ["HEAD", "/api/health"], ["GET", "/sw.js"], ["GET", "/assets/x.js"], ["POST", "/api/pair/redeem"]] as const) {
      expect((await req(port, { method: m, path: p, headers: { cookie: "pi_dash_local=a; pi_dash_local=b" } })).status, `${m} ${p}`).toBe(400);
    }
    expect(calls).toEqual([]);
  });
  it("a single cookie and non-dashboard duplicates pass untouched", async () => {
    const { port, calls } = await mkApp();
    expect((await req(port, { headers: { cookie: "pi_dash_token=a; theme=1; theme=2" } })).status).toBe(200);
    expect(calls).toEqual(["handler"]);
  });
  it("E112: the refusal runs before authentication — a valid-looking ticket is never consumed", async () => {
    const { port, calls } = await mkApp();
    const r = await req(port, { path: "/ws?ticket=abc", headers: { cookie: "pi_dash_token=a; pi_dash_token=b", authorization: "Bearer x" } });
    expect(r.status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe("the refusal log (E110 log, P13)", () => {
  it("logs once per name per minute, count carried, route redacted, name truncated; ≤ 256 names tracked", () => {
    let t = 0;
    const lines: string[] = [];
    const log = new DuplicateCookieLog((l) => lines.push(l), () => t);
    log.note("pi_dash_token", 2, "/preview/PIDSECRET/app.js?x=1");
    log.note("pi_dash_token", 3, "/x");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("count=2");
    expect(lines[0]).not.toContain("PIDSECRET");
    t += 61_000;
    log.note("pi_dash_token", 50, "/x");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("count=50");
    log.note(`pi_dash_${"y".repeat(500)}`, 2, "/");
    expect(lines[2].match(/name=(\S+)/)?.[1].length).toBeLessThanOrEqual(128);
    for (let i = 0; i < 400; i++) log.note(`pi_dash_n${i}`, 2, "/");
    // the oldest names were evicted, so an early name logs again inside the window
    const before = lines.length;
    log.note("pi_dash_n0", 2, "/");
    expect(lines.length).toBe(before + 1);
  });
});

describe("upgrade refusal (E124)", () => {
  it("writes a valid 400 head with expiry lines and destroys the socket; a clean upgrade is untouched", () => {
    const written: string[] = [];
    const socket = { write: (s: string) => written.push(s), destroy: vi.fn() } as never;
    const request = { headers: { cookie: "pi_dash_local=a; pi_dash_local=b", host: "localhost:8000" }, url: "/ws/terminal/T" } as never;
    expect(refuseDuplicateCookieUpgrade(request, socket, { log: new DuplicateCookieLog(() => {}), tier2: () => false })).toBe(true);
    expect(written[0].startsWith("HTTP/1.1 400 Bad Request\r\n")).toBe(true);
    expect(written[0].endsWith("\r\n\r\n")).toBe(true);
    expect(written[0]).toContain("Set-Cookie: pi_dash_local=; Max-Age=0; Path=/ws/terminal/T");
    expect((socket as unknown as { destroy: ReturnType<typeof vi.fn> }).destroy).toHaveBeenCalled();
    const clean = { headers: { cookie: "pi_dash_local=a" }, url: "/ws" } as never;
    expect(refuseDuplicateCookieUpgrade(clean, socket)).toBe(false);
  });
});

describe("inside the real dashboard server (E124, E125)", () => {
  let handle: TestServerHandle | undefined;
  afterEach(async () => {
    await handle?.stop();
    handle = undefined;
  });

  it("HTTP: dup cookie → 400 on health and an unrouted path; WS upgrade → 400 head on every scope; no dashboard handler", async () => {
    handle = await createTestServer();
    const port = handle.httpPort;
    const h = await req(port, { path: "/api/health", headers: { host: `localhost:${port}`, cookie: "pi_dash_token=a; pi_dash_token=b" } });
    expect(h.status).toBe(400);
    expect(JSON.parse(h.body).error).toBe("duplicate_dashboard_cookie");
    const ok = await req(port, { path: "/api/health", headers: { host: `localhost:${port}`, cookie: "pi_dash_token=a" } });
    expect(ok.status).toBe(200);
    for (const p of ["/ws", "/ws/bridge", "/ws/terminal/T", "/live/L", "/ws/nope"]) {
      const out = await new Promise<string>((resolve) => {
        const s = net.connect(port, "127.0.0.1", () =>
          s.write(`GET ${p} HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nCookie: pi_dash_local=a; pi_dash_local=b\r\nSec-WebSocket-Key: x\r\nSec-WebSocket-Version: 13\r\n\r\n`),
        );
        let buf = "";
        s.on("data", (c) => {
          buf += c.toString();
        });
        s.on("close", () => resolve(buf));
        s.on("error", () => resolve(buf));
      });
      expect(out.startsWith("HTTP/1.1 400"), p).toBe(true);
      expect(out, p).toContain("Set-Cookie: pi_dash_local=; Max-Age=0; Path=/");
    }
  });
});
