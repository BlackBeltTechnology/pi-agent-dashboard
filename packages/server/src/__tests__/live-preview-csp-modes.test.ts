/**
 * Baseline CSP × live-preview `frame-src`: mode matrix with a route-level CSP already present (T.E149) and the per-request
 * cost of building the per-tier `frame-src` (T.P16).
 *
 * See change: serve-live-previews-on-capability-origin (D6; test-plan #E149, #P16).
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { parsePreviewOrigins, resolvePreviewOrigins } from "@blackbelt-technology/pi-dashboard-shared/preview-origins.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCsp, type CspMode, previewFrameSources, registerCsp } from "../auth/csp.js";
import { configSnapshotParseCount, getResolvedPreviewOrigins, resetConfigSnapshot } from "../config-snapshot.js";
import { LiveCapabilityStore } from "../live-server/live-capability.js";
import type { LiveServerManager } from "../live-server/live-server-manager.js";
import { createPreviewDispatch, previewServerFactory } from "../live-server/preview-dispatch.js";

const RO = "content-security-policy-report-only";
const EN = "content-security-policy";
const ROUTE_CSP = "sandbox allow-scripts";
const arr = (v: unknown): string[] => (v === undefined ? [] : ([] as string[]).concat(v as string | string[]));

let tmp: string;
let origHome: string | undefined;
let tick = 0;
const cfgFile = () => path.join(tmp, ".pi", "dashboard", "config.json");
function writeConfig(previewOrigins: object): void {
  fs.mkdirSync(path.dirname(cfgFile()), { recursive: true });
  fs.writeFileSync(cfgFile(), JSON.stringify({ liveServer: { previewOrigins } }), { mode: 0o600 });
  tick += 2;
  const t = new Date(1_700_000_000_000 + tick * 1000);
  fs.utimesSync(cfgFile(), t, t);
}
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lp-csp-"));
  origHome = process.env.HOME;
  process.env.HOME = tmp;
  resetConfigSnapshot();
});
afterEach(() => {
  process.env.HOME = origHome;
  resetConfigSnapshot();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const ALL_TIERS = { portPool: "8100-8199", ipDnsSuffix: "sslip.io", wildcard: { suffix: "preview.test", forHosts: ["dash.test"], scheme: "http" } };
const HOST_IP = "192.168.1.5:8000";
/** Every per-tier source the Host `192.168.1.5:8000` yields with all tiers configured. */
const IP_FRAMES = ["http://*.localhost:8000", "http://*.192-168-1-5.sslip.io:8000", "http://192.168.1.5:*", "http://*.preview.test"];

async function csp(mode: CspMode, route: (app: FastifyInstance) => void): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerCsp(app, mode);
  route(app);
  await app.ready();
  return app;
}
const html = (app: FastifyInstance, url: string, host = HOST_IP) =>
  app.inject({ method: "GET", url, headers: { host, accept: "text/html" } });
const frameSrc = (policy: string): string => policy.split("; ").find((d) => d.startsWith("frame-src")) ?? "";

describe("T.E149 / #E149 — baseline-csp modes with an existing route CSP", () => {
  const routes = (app: FastifyInstance) => {
    app.get("/page", async (_req, reply) => reply.type("text/html").send("<html></html>"));
    // framed-dashboard F8 layer (a) / editor raw route: the route sets its own ENFORCED policy
    app.get("/sandboxed", async (_req, reply) => reply.header(EN, ROUTE_CSP).type("text/html").send("<html></html>"));
  };

  it("report: baseline + strict Report-Only, each with the per-tier frame-src; a route's enforced CSP is never overwritten", async () => {
    writeConfig(ALL_TIERS);
    const app = await csp("report", routes);
    try {
      for (const url of ["/page", "/sandboxed"]) {
        const res = await html(app, url);
        const ro = arr(res.headers[RO]);
        expect(ro, url).toHaveLength(2);
        expect(ro[0]).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'"); // baseline
        expect(ro[0]).toContain("report-uri /__pi/csp-report/baseline");
        expect(ro[1]).toContain("script-src 'self';"); // strict: no unsafe-inline / unsafe-eval (no nonce: no route minted one)
        expect(ro[1]).not.toContain("'unsafe-inline' 'unsafe-eval'");
        expect(ro[1]).toContain("report-uri /__pi/csp-report/strict");
        for (const p of ro) {
          const fs = frameSrc(p);
          expect(fs).toMatch(/^frame-src 'self' https:/);
          for (const src of IP_FRAMES) expect(fs, url).toContain(src);
        }
      }
      expect(arr((await html(app, "/page")).headers[EN])).toEqual([]); // nothing enforced from the baseline
      expect(arr((await html(app, "/sandboxed")).headers[EN])).toEqual([ROUTE_CSP]); // the route's policy stands
    } finally {
      await app.close();
    }
  });

  it("enforce: strict enforcing only (no Report-Only); a route's enforced CSP is never overwritten", async () => {
    writeConfig(ALL_TIERS);
    const app = await csp("enforce", routes);
    try {
      const page = await html(app, "/page");
      const enforced = arr(page.headers[EN]);
      expect(enforced).toHaveLength(1);
      expect(enforced[0]).toContain("script-src 'self';");
      expect(enforced[0]).not.toContain("'unsafe-inline' 'unsafe-eval'");
      expect(enforced[0]).toContain("report-uri /__pi/csp-report/strict");
      for (const src of IP_FRAMES) expect(frameSrc(enforced[0])).toContain(src);
      expect(arr(page.headers[RO])).toEqual([]);

      const sandboxed = await html(app, "/sandboxed");
      expect(arr(sandboxed.headers[EN])).toEqual([ROUTE_CSP]);
      expect(arr(sandboxed.headers[RO])).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("off: no hook is registered; the route-level CSP stands and nothing is added", async () => {
    writeConfig(ALL_TIERS);
    const app = Fastify({ logger: false });
    registerCsp(app, "off");
    routes(app);
    await app.ready();
    try {
      const page = await html(app, "/page");
      expect(arr(page.headers[EN])).toEqual([]);
      expect(arr(page.headers[RO])).toEqual([]);
      const sandboxed = await html(app, "/sandboxed");
      expect(arr(sandboxed.headers[EN])).toEqual([ROUTE_CSP]);
      expect(arr(sandboxed.headers[RO])).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("off: a capability (preview-origin) response still carries its route-level CSP, in every dashboard mode", async () => {
    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html>up</html>");
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
    const upPort = (upstream.address() as AddressInfo).port;
    const manager = {
      get: (id: string) => (id === "vite-5173" ? { id, label: id, host: "127.0.0.1", port: upPort } : undefined),
      getStatic: () => undefined,
      has: () => true,
      use: () => {},
      list: () => [],
    } as unknown as LiveServerManager;
    writeConfig({});
    const store = new LiveCapabilityStore({ isTargetLive: () => true });
    const dispatch = createPreviewDispatch({ store, manager, isPeerLocal: () => true });
    const minted = store.mint("vite-5173", { kind: "local" }, { preview: { tier: 1, ancestors: ["http://localhost:8000"], buildOrigin: (l) => ({ origin: `http://${l}.localhost:8000`, originHost: `${l}.localhost:8000` }) } });
    const conns = new Set<Socket>();
    try {
      for (const mode of ["off", "report", "enforce"] as const) {
        const front = Fastify({ logger: false, serverFactory: previewServerFactory(() => dispatch) as never });
        registerCsp(front, mode);
        front.get("/", async () => "dashboard");
        await dispatch.ready();
        await front.listen({ port: 0, host: "127.0.0.1" });
        front.server.on("connection", (s) => {
          conns.add(s);
          s.on("close", () => conns.delete(s));
        });
        const port = (front.server.address() as AddressInfo).port;
        const res = await new Promise<http.IncomingHttpHeaders>((resolve, reject) => {
          const r = http.request({ host: "127.0.0.1", port, path: "/", headers: { host: `${minted.token}.localhost:8000` }, setHost: false, agent: false }, (m) => {
            m.resume();
            m.on("end", () => resolve(m.headers));
          });
          r.on("error", reject);
          r.end();
        });
        const policy = String(res[EN] ?? "");
        expect(policy, mode).toContain("frame-ancestors http://localhost:8000"); // the capability's own CSP (D6), not the dashboard's
        expect(policy, mode).not.toContain("report-uri /__pi/csp-report/strict");
        expect(arr(res[RO]), mode).toEqual([]);
        for (const c of conns) c.destroy();
        await front.close();
      }
    } finally {
      await dispatch.close();
      store.close();
      await new Promise<void>((r) => upstream.close(() => r()));
    }
  });
});

describe("T.P16 / #P16 — per-request frame-src cost", () => {
  const resolveWith = (raw: object) =>
    resolvePreviewOrigins(parsePreviewOrigins(raw).value, { port: 8000, piPort: 9999, allowedHosts: [], publicBaseUrls: [], corsOrigins: [] });
  const SHAPES: { host: string; port: number }[] = [
    { host: "localhost:8000", port: 8000 },
    { host: "127.0.0.1:8000", port: 8000 },
    { host: HOST_IP, port: 8000 },
    { host: "dash.test:8000", port: 8000 },
    { host: "[::1]:8000", port: 8000 },
  ];

  it("50k header builds across 5 Host shapes: byte length identical for a 1-port and a 100-port pool (`:*` form); sources per shape constant", () => {
    const small = resolveWith({ ...ALL_TIERS, portPool: "8100-8100" });
    const big = resolveWith({ ...ALL_TIERS, portPool: "8100-8199" });
    expect(small.pool).toEqual({ from: 8100, to: 8100 });
    expect(big.pool).toEqual({ from: 8100, to: 8199 });
    const bytes = { small: new Map<string, Set<number>>(), big: new Map<string, Set<number>>() };
    const N = 50_000;
    for (let i = 0; i < N; i++) {
      const s = SHAPES[i % SHAPES.length];
      for (const [name, cfg] of [["small", small], ["big", big]] as const) {
        const header = buildCsp(previewFrameSources(s.host, s.port, cfg));
        const set = bytes[name].get(s.host) ?? new Set<number>();
        set.add(Buffer.byteLength(header));
        bytes[name].set(s.host, set);
      }
    }
    for (const s of SHAPES) {
      expect(bytes.small.get(s.host)?.size, s.host).toBe(1); // deterministic per shape
      expect(bytes.big.get(s.host)?.size, s.host).toBe(1);
      expect([...(bytes.big.get(s.host) ?? [])], s.host).toEqual([...(bytes.small.get(s.host) ?? [])]); // pool size 1 vs 100: same size
    }
    // the pool contributes exactly one `:*` entry per IPv4 shape, never one entry per port
    expect(previewFrameSources(HOST_IP, 8000, big).filter((x) => x.includes(":*"))).toEqual(["http://192.168.1.5:*"]);
    expect(previewFrameSources(HOST_IP, 8000, big)).toEqual(previewFrameSources(HOST_IP, 8000, small));
    expect(previewFrameSources("[::1]:8000", 8000, big)).toEqual([]); // IPv6: no entry
  });

  it("2k real HTML responses across the 5 shapes: constant header size per shape, and zero config re-parses after the first", async () => {
    writeConfig(ALL_TIERS);
    getResolvedPreviewOrigins(); // warm the snapshot (the one parse)
    const app = Fastify({ logger: false });
    registerCsp(app, "report");
    app.get("/", async (_req, reply) => reply.type("text/html").send("<html></html>"));
    await app.ready();
    try {
      await html(app, "/", "localhost:8000"); // first response primes the memo
      const parses = configSnapshotParseCount();
      const sizes = new Map<string, Set<number>>();
      for (let i = 0; i < 2_000; i++) {
        const s = SHAPES[i % SHAPES.length];
        const res = await html(app, "/", s.host);
        const total = arr(res.headers[RO]).reduce((n, h) => n + Buffer.byteLength(h.replace(/'nonce-[^']+'/, "'nonce-X'")), 0);
        const set = sizes.get(s.host) ?? new Set<number>();
        set.add(total);
        sizes.set(s.host, set);
      }
      for (const s of SHAPES) expect(sizes.get(s.host)?.size, s.host).toBe(1);
      expect(configSnapshotParseCount()).toBe(parses); // no per-request config re-parse
      // shapes that get the pool/ipDns entries are larger than the ones that do not, by a constant amount
      expect([...(sizes.get(HOST_IP) ?? [])][0]).toBeGreaterThan([...(sizes.get("dash.test:8000") ?? [])][0]);
    } finally {
      await app.close();
    }
  }, 60_000);
});
