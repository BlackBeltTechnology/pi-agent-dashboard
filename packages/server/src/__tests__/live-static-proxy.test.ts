/**
 * Static-target branch of the `/live/:id/~c/<token>/` proxy, plus the port-target
 * CSP / X-Forwarded-For additions.
 *
 *  E12 file-only grant   E13 forbidden names   E14 headers   E15 Range + streaming
 *  E20 port target: upstream CSP + ours, X-Forwarded-For
 *  X2  revoke mid-session   X3 symlink escape   X4 raw dot / encoded traversal
 *  X11 policy comes from the token only
 *  P1  static serve overhead   P2  per-request gate cost
 *
 * See change: improve-canvas-html-and-url-ux (test-plan E12–E15, E20, X2–X4, X11, P1, P2).
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateContainment } from "../access/containment-gate.js";
import { createNetworkGuardHook } from "../auth/localhost-guard.js";
import { createLiveCapabilityHook, LiveCapabilityStore } from "../live-server/live-capability.js";
import { createLiveServerManager, type LiveServerManager } from "../live-server/live-server-manager.js";
import { registerLiveServerProxy } from "../live-server/live-server-proxy.js";

const REMOTE = "203.0.113.5";

function fakePrefs() {
  let store: any[] = [];
  return { getLiveServers: () => store, setLiveServers: (t: any[]) => (store = t) } as any;
}

/** A tempdir whose real path is used everywhere (macOS `/var` → `/private/var`). */
function mkTmp(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function write(root: string, rel: string, content: string | Buffer = "x") {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

interface Fixture {
  app: FastifyInstance;
  manager: LiveServerManager;
  store: LiveCapabilityStore;
  root: string;
  cwd: string;
  id: string;
  gate: { allow: (cwd: string, abs: string) => boolean; calls: string[] };
  mint(policy?: { egress?: "open" | "restricted"; scripts?: boolean }): string;
}

async function makeStatic(opts: { cwd?: string; root?: string } = {}): Promise<Fixture> {
  const cwd = opts.cwd ?? mkTmp("live-static-cwd-");
  const root = opts.root ?? cwd;
  const manager = createLiveServerManager(fakePrefs());
  const reg = manager.startStatic({ cwd, root });
  if (!reg.ok) throw new Error("startStatic failed");
  const id = reg.target.id;
  const store = new LiveCapabilityStore({ isTargetLive: (i) => manager.has(i) });
  const gate = {
    calls: [] as string[],
    allow: (_cwd: string, abs: string) => abs.startsWith(`${cwd}${path.sep}`),
  };
  const app = Fastify({ logger: false });
  app.decorateRequest("isAuthenticated", false);
  app.addHook("onRequest", createLiveCapabilityHook(store));
  app.addHook("onRequest", createNetworkGuardHook({ trustedNetworks: () => [], logDenial: () => {} }));
  registerLiveServerProxy(app, manager, {
    staticGate: async (c, abs) => {
      gate.calls.push(abs);
      return gate.allow(c, abs);
    },
  });
  await app.ready();
  return {
    app,
    manager,
    store,
    root,
    cwd,
    id,
    gate,
    mint: (policy = {}) => {
      const { token } = store.mint(id, { kind: "local" }, { kind: "static", policy });
      return `/live/${id}/~c/${token}`;
    },
  };
}

const rm = (...dirs: string[]) => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
};

describe("static branch — admission and forbidden names", () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await makeStatic();
  });
  afterEach(async () => {
    await f.app.close();
    rm(f.cwd);
  });

  it("serves an allowed file through a capability; the root defaults to index.html", async () => {
    write(f.root, "index.html", "<h1>hi</h1>");
    write(f.root, "sub/page.html", "<p>sub</p>");
    const p = f.mint();
    const idx = await f.app.inject({ method: "GET", url: `${p}/` });
    expect(idx.statusCode).toBe(200);
    expect(idx.body).toBe("<h1>hi</h1>");
    const sub = await f.app.inject({ method: "GET", url: `${p}/sub/page.html?x=1#frag` });
    expect(sub.statusCode).toBe(200);
    expect(sub.body).toBe("<p>sub</p>");
  });

  it("X1 — a tokenless request is a 404 for every caller, even genuinely local, without markers", async () => {
    write(f.root, "index.html");
    const res = await f.app.inject({ method: "GET", url: `/live/${f.id}/index.html` });
    expect(res.statusCode).toBe(404);
    // A token for ANOTHER target does not open it either.
    const other = f.store.mint("port-1", { kind: "local" }, { kind: "static" }).token;
    expect((await f.app.inject({ method: "GET", url: `/live/${f.id}/~c/${other}/index.html` })).statusCode).toBe(404);
  });

  it("E12 — a file-only grant serves only that file; its sibling is a 404", async () => {
    const shared = mkTmp("live-shared-");
    const cwd = mkTmp("live-cwd-");
    write(shared, "report.html", "<p>r</p>");
    write(shared, "other.html", "<p>o</p>");
    const g = await makeStatic({ cwd, root: shared });
    g.gate.allow = (_c, abs) => abs === path.join(shared, "report.html");
    const p = g.mint();
    expect((await g.app.inject({ method: "GET", url: `${p}/report.html` })).statusCode).toBe(200);
    expect((await g.app.inject({ method: "GET", url: `${p}/other.html` })).statusCode).toBe(404);
    await g.app.close();
    rm(shared, cwd);
  });

  it("E13 — credential-like / dot / map / database / node_modules paths are all 404 except style.css", async () => {
    const files = [
      ".env",
      "config/secrets.json",
      "certs/server.pem",
      "auth.json",
      "api-token.json",
      "app.js.map",
      "data/dump.sqlite",
      "node_modules/x/a.js",
      ".git/config",
      "private/readme.html",
      "notes.txt",
    ];
    for (const rel of files) write(f.root, rel, "SECRET");
    write(f.root, "style.css", "body{}");
    const p = f.mint();
    for (const rel of files) {
      const res = await f.app.inject({ method: "GET", url: `${p}/${rel}` });
      expect(res.statusCode, rel).toBe(404);
      expect(res.body).not.toContain("SECRET");
    }
    expect((await f.app.inject({ method: "GET", url: `${p}/style.css` })).statusCode).toBe(200);
  });

  it("E14 — headers: MIME, no-store, nosniff, no-referrer, and the open+scripts CSP", async () => {
    write(f.root, "style.css", "body{}");
    const res = await f.app.inject({ method: "GET", url: `${f.mint({ egress: "open", scripts: true })}/style.css` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/css; charset=utf-8");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    const csp = String(res.headers["content-security-policy"]);
    expect(csp).toContain("sandbox allow-scripts allow-forms allow-popups allow-downloads");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
  });

  it("a non-GET/HEAD method is 405 and a HEAD carries no body", async () => {
    write(f.root, "a.css", "body{}");
    const p = f.mint();
    expect((await f.app.inject({ method: "POST", url: `${p}/a.css` })).statusCode).toBe(405);
    const head = await f.app.inject({ method: "HEAD", url: `${p}/a.css` });
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe("");
  });

  it("an unsatisfiable Range is a 416; a malformed one serves the full file", async () => {
    write(f.root, "a.css", "0123456789");
    const p = f.mint();
    const bad = await f.app.inject({ method: "GET", url: `${p}/a.css`, headers: { range: "bytes=50-60" } });
    expect(bad.statusCode).toBe(416);
    expect(bad.headers["content-range"]).toBe("bytes */10");
    const junk = await f.app.inject({ method: "GET", url: `${p}/a.css`, headers: { range: "bytes=a-b" } });
    expect(junk.statusCode).toBe(200);
    const mid = await f.app.inject({ method: "GET", url: `${p}/a.css`, headers: { range: "bytes=2-4" } });
    expect(mid.statusCode).toBe(206);
    expect(mid.body).toBe("234");
  });
});

describe("static branch — per-request gate, symlinks, traversal", () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await makeStatic();
  });
  afterEach(async () => {
    await f.app.close();
    rm(f.cwd);
  });

  it("X2 — a grant revoked mid-session takes effect on the next request, no restart", async () => {
    write(f.root, "a.css", "body{}");
    const p = f.mint();
    expect((await f.app.inject({ method: "GET", url: `${p}/a.css` })).statusCode).toBe(200);
    f.gate.allow = () => false; // grant / pin revoked
    expect((await f.app.inject({ method: "GET", url: `${p}/a.css` })).statusCode).toBe(404);
    expect(f.gate.calls.length).toBeGreaterThanOrEqual(2); // gated per request, not per mint
  });

  it("X3 — a symlink out of the root is a 404; a symlink to a credential inside it too", async () => {
    const outside = mkTmp("live-outside-");
    write(outside, "hosts.html", "OUTSIDE");
    fs.symlinkSync(path.join(outside, "hosts.html"), path.join(f.root, "link.html"));
    write(f.root, ".env", "SECRET");
    fs.symlinkSync(path.join(f.root, ".env"), path.join(f.root, "ok.html"));
    const p = f.mint();
    for (const name of ["link.html", "ok.html"]) {
      const res = await f.app.inject({ method: "GET", url: `${p}/${name}` });
      expect(res.statusCode, name).toBe(404);
      expect(res.body).not.toContain("OUTSIDE");
      expect(res.body).not.toContain("SECRET");
    }
    rm(outside);
  });

  it("X4 — raw %2e%2e and ..%2f traversal are 404s and no file outside the root is opened", async () => {
    const secret = write(path.dirname(f.root), "secret-outside.json", "{}");
    const open = vi.spyOn(fs.promises, "open");
    const realpath = vi.spyOn(fs.promises, "realpath");
    try {
      const p = f.mint();
      for (const raw of [
        `${p}/%2e%2e/%2e%2e/etc/hosts`,
        `${p}/a/..%2f..%2fsecret-outside.json`,
        `${p}/..%2f..%2fsecret-outside.json`,
        `${p}/%252e%252e/secret-outside.json`,
        `${p}/a%5c..%5csecret-outside.json`,
        `${p}/a%00.css`,
      ]) {
        const res = await f.app.inject({ method: "GET", url: raw });
        expect(res.statusCode, raw).toBe(404);
      }
      const touched = [...open.mock.calls, ...realpath.mock.calls].map((c) => String(c[0]));
      expect(touched.filter((t) => !t.startsWith(f.root))).toEqual([]);
    } finally {
      open.mockRestore();
      realpath.mockRestore();
      rm(secret);
    }
  });

  it("X4 — an in-token double-encoded segment that survives the capability parse is still refused", async () => {
    write(f.root, "x.css", "body{}");
    const p = f.mint();
    // `%25` is not blocked by the capability parser; the static branch decodes ONCE and refuses a residual `%2e`.
    const res = await f.app.inject({ method: "GET", url: `${p}/%252e%252e/x.css` });
    expect(res.statusCode).toBe(404);
  });

  it("X11 — the policy comes from the token only: ?egress=open and X-Egress: open change nothing", async () => {
    write(f.root, "a.css", "body{}");
    const p = f.mint({ egress: "restricted", scripts: true });
    const res = await f.app.inject({
      method: "GET",
      url: `${p}/a.css?egress=open&scripts=1`,
      headers: { "x-egress": "open", host: "dash.example:8000" },
    });
    expect(res.statusCode).toBe(200);
    const csp = String(res.headers["content-security-policy"]);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("sandbox allow-scripts allow-forms;");
    expect(csp).not.toContain("allow-popups");
  });
});

describe("E15 — large file: Range → 206, full GET streamed (no buffering)", () => {
  it("60 MB sparse file: 206 with the right Content-Range; a full GET stays under +20 MB RSS", async () => {
    const f = await makeStatic();
    const abs = write(f.root, "media/demo.webm", "");
    fs.truncateSync(abs, 62_914_560);
    const base = await f.app.listen({ port: 0, host: "127.0.0.1" });
    const port = Number(new URL(base).port);
    const p = f.mint();
    const get = (headers: Record<string, string>) =>
      new Promise<{ status: number; headers: http.IncomingHttpHeaders; bytes: number; peakRss: number }>((resolve, reject) => {
        const startRss = process.memoryUsage().rss;
        let peak = startRss;
        http
          .get({ host: "127.0.0.1", port, path: `${p}/media/demo.webm`, headers }, (res) => {
            let bytes = 0;
            res.on("data", (c: Buffer) => {
              bytes += c.length;
              peak = Math.max(peak, process.memoryUsage().rss);
            });
            res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, bytes, peakRss: peak - startRss }));
            res.on("error", reject);
          })
          .on("error", reject);
      });
    const ranged = await get({ range: "bytes=1000000-" });
    expect(ranged.status).toBe(206);
    expect(ranged.headers["content-range"]).toBe("bytes 1000000-62914559/62914560");
    expect(ranged.bytes).toBe(62_914_560 - 1_000_000);
    const full = await get({});
    expect(full.status).toBe(200);
    expect(full.bytes).toBe(62_914_560);
    expect(full.peakRss).toBeLessThan(20 * 1024 * 1024);
    await f.app.close();
    rm(f.cwd);
  }, 60_000);
});

describe("E20 — port target: upstream CSP kept, ours appended, X-Forwarded-For set", () => {
  const sockets = new Set<Socket>();
  let upstream: http.Server;
  let upstreamPort = 0;
  let seen: http.IncomingHttpHeaders | undefined;
  let app: FastifyInstance;
  let store: LiveCapabilityStore;

  beforeEach(async () => {
    seen = undefined;
    upstream = http.createServer((req, res) => {
      seen = req.headers;
      res.writeHead(200, {
        "content-type": "text/html",
        "content-security-policy": "default-src 'self'",
      });
      res.end("<p>app</p>");
    });
    upstream.on("connection", (s) => {
      sockets.add(s);
      s.on("close", () => sockets.delete(s));
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
    upstreamPort = (upstream.address() as AddressInfo).port;
    const manager: LiveServerManager = {
      start: () => ({ ok: false, error: "unused" }),
      startPreset: () => ({ ok: false, error: "unused" }),
      startStatic: () => ({ ok: false, error: "unused" }),
      get: (id) => (id === "vite-5173" ? { id, label: id, host: "127.0.0.1", port: upstreamPort } : undefined),
      getStatic: () => undefined,
      has: (id) => id === "vite-5173",
      list: () => [],
      remove: () => {},
      use: () => {},
      setEvictionListener: () => {},
    };
    store = new LiveCapabilityStore();
    app = Fastify({ logger: false });
    app.decorateRequest("isAuthenticated", false);
    app.addHook("onRequest", createLiveCapabilityHook(store));
    app.addHook("onRequest", createNetworkGuardHook({ trustedNetworks: () => [], logDenial: () => {} }));
    registerLiveServerProxy(app, manager);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    for (const s of sockets) s.destroy();
    await new Promise<void>((r) => upstream.close(() => r()));
  });

  it("upstream sees X-Forwarded-For; the response has BOTH CSP headers (upstream's intact + ours with sandbox)", async () => {
    const { token } = store.mint("vite-5173", { kind: "local" }, { kind: "port", policy: { egress: "restricted", scripts: true } });
    const res = await app.inject({
      method: "GET",
      url: `/live/vite-5173/~c/${token}/`,
      headers: { host: "dash.example:8000" },
    });
    expect(res.statusCode).toBe(200);
    expect(seen?.["x-forwarded-for"]).toContain("127.0.0.1");
    const csp = res.headers["content-security-policy"];
    expect(Array.isArray(csp)).toBe(true);
    const list = csp as unknown as string[];
    expect(list).toHaveLength(2);
    expect(list[0]).toBe("default-src 'self'");
    expect(list[1]).toContain("sandbox allow-scripts allow-forms");
    expect(list[1]).toContain(`http://dash.example:8000/live/vite-5173/~c/${token}/`);
    expect(String(res.headers["reporting-endpoints"])).toContain("__pi/csp-report");
  });

  it("a request with no capability (non-browser local caller) is proxied unchanged — no CSP added", async () => {
    const res = await app.inject({ method: "GET", url: "/live/vite-5173/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-security-policy"]).toBe("default-src 'self'");
  });

  it("a client X-Forwarded-For is extended, not replaced", async () => {
    const { token } = store.mint("vite-5173", { kind: "local" }, { kind: "port" });
    await app.inject({
      method: "GET",
      url: `/live/vite-5173/~c/${token}/`,
      headers: { "x-forwarded-for": "198.51.100.7" },
    });
    expect(seen?.["x-forwarded-for"]).toBe("198.51.100.7, 127.0.0.1");
  });
});

describe("P1 / P2 — performance budgets", () => {
  it("P1 — serving a 2 MiB HTML (10 linked CSS) adds ≤150 ms p95 over a plain readFile (50 runs)", async () => {
    const cwd = mkTmp("live-p1-");
    const html = `<html><head>${Array.from({ length: 10 }, (_, i) => `<link rel="stylesheet" href="c${i}.css">`).join("")}</head><body>${"x".repeat(2 * 1024 * 1024)}</body></html>`;
    write(cwd, "index.html", html);
    for (let i = 0; i < 10; i++) write(cwd, `c${i}.css`, "body{color:red}");
    const f = await makeStatic({ cwd });
    const added: number[] = [];
    for (let i = 0; i < 50; i++) {
      // Fresh target per run: register + mint + serve.
      const t0 = performance.now();
      const reg = f.manager.startStatic({ cwd, root: cwd });
      expect(reg.ok).toBe(true);
      const res = await f.app.inject({ method: "GET", url: `${f.mint({ egress: "restricted" })}/index.html` });
      const served = performance.now() - t0;
      expect(res.statusCode).toBe(200);
      const b0 = performance.now();
      fs.readFileSync(path.join(cwd, "index.html"));
      const baseline = performance.now() - b0;
      added.push(served - baseline);
    }
    added.sort((a, b) => a - b);
    expect(added[Math.floor(added.length * 0.95)]).toBeLessThanOrEqual(150);
    await f.app.close();
    rm(cwd);
  }, 120_000);

  it("P2 — the REAL per-request gate costs ≤10 ms p95 over 200 requests for a 20 KB CSS", async () => {
    const cwd = mkTmp("live-p2-");
    write(cwd, "a.css", "a".repeat(20 * 1024));
    const f = await makeStatic({ cwd });
    const times: number[] = [];
    // Rebuild the app with an instrumented real gate (containment over the real path).
    await f.app.close();
    const manager = f.manager;
    const store = new LiveCapabilityStore({ isTargetLive: (i) => manager.has(i) });
    const app = Fastify({ logger: false });
    app.decorateRequest("isAuthenticated", false);
    app.addHook("onRequest", createLiveCapabilityHook(store));
    registerLiveServerProxy(app, manager, {
      staticGate: async (c, abs) => {
        const t0 = performance.now();
        const d = await evaluateContainment(abs, [c], { site: "test:p2", allowGrant: true, quiet: true });
        times.push(performance.now() - t0);
        return d.allowed;
      },
    });
    await app.ready();
    const { token } = store.mint(f.id, { kind: "local" }, { kind: "static" });
    for (let i = 0; i < 200; i++) {
      const res = await app.inject({ method: "GET", url: `/live/${f.id}/~c/${token}/a.css` });
      expect(res.statusCode).toBe(200);
    }
    times.sort((a, b) => a - b);
    expect(times).toHaveLength(200);
    expect(times[Math.floor(times.length * 0.95)]).toBeLessThanOrEqual(10);
    await app.close();
    rm(cwd);
  }, 60_000);
});

// Guard against an accidental REMOTE-only assumption: the guard still 403s a remote tokenless caller.
describe("a remote tokenless static request never reaches the file", () => {
  it("is refused by the universal guard (403) before the proxy", async () => {
    const f = await makeStatic();
    write(f.root, "index.html");
    const res = await f.app.inject({ method: "GET", url: `/live/${f.id}/index.html`, remoteAddress: REMOTE });
    expect([403, 404]).toContain(res.statusCode);
    await f.app.close();
    rm(f.cwd);
  });
});
