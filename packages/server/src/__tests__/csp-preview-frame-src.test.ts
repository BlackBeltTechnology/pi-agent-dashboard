/**
 * Dashboard page `frame-src` per request (D6) and capability-response CSP per tier.
 * See change: serve-live-previews-on-capability-origin (D6; test-plan #E55-#E64 family).
 */
import { parsePreviewOrigins, resolvePreviewOrigins } from "@blackbelt-technology/pi-dashboard-shared/preview-origins.js";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { previewFrameSources, registerCsp } from "../auth/csp.js";
import { buildLiveCsp } from "../live-server/live-csp.js";

const ctx = { port: 8000, piPort: 9999, allowedHosts: [], publicBaseUrls: [], corsOrigins: [] };
const resolve = (raw: object) => resolvePreviewOrigins(parsePreviewOrigins(raw).value, ctx);
const on = resolve({ enabled: true });

describe("previewFrameSources (dashboard frame-src)", () => {
  it("localhost on the page's own port, never :*", () => {
    expect(previewFrameSources("localhost:9000", 9000, on)).toEqual(["http://*.localhost:9000"]);
    expect(previewFrameSources("localhost", 9000, on)).toEqual(["http://*.localhost:9000"]);
    expect(previewFrameSources("localhost:80", 80, on)).toEqual(["http://*.localhost"]);
  });
  it("none when previews are disabled, or for an IPv6 literal / malformed Host", () => {
    expect(previewFrameSources("localhost:8000", 8000, resolve({ enabled: false }))).toEqual([]);
    const all = resolve({ enabled: true, portPool: "8100-8199", ipDnsSuffix: "sslip.io" });
    expect(previewFrameSources("[::1]:8000", 8000, all)).toEqual([]);
    expect(previewFrameSources("a b", 8000, all)).toEqual([]);
    expect(previewFrameSources(undefined, 8000, all)).toEqual([]);
  });
  it("ipDns + pool entries only for an IPv4 literal Host", () => {
    const all = resolve({ enabled: true, portPool: "8100-8199", ipDnsSuffix: "sslip.io" });
    expect(previewFrameSources("192.168.1.5:8000", 8000, all)).toEqual([
      "http://*.localhost:8000",
      "http://*.192-168-1-5.sslip.io:8000",
      "http://192.168.1.5:*",
    ]);
    expect(previewFrameSources("192.168.1.5", 80, all)).toContain("http://*.192-168-1-5.sslip.io");
    expect(previewFrameSources("dash.example.com:8000", 8000, all)).toEqual(["http://*.localhost:8000"]);
  });
  it("http wildcard only while its scheme is http; port elided at the default", () => {
    const http = resolve({ enabled: true, wildcard: { suffix: "preview.test", forHosts: ["dash.test"], scheme: "http", port: 8000 } });
    expect(previewFrameSources("dash.test:8000", 8000, http)).toContain("http://*.preview.test:8000");
    const http80 = resolve({ enabled: true, wildcard: { suffix: "preview.test", forHosts: ["dash.test"], scheme: "http", port: 80 } });
    expect(previewFrameSources("dash.test", 80, http80)).toContain("http://*.preview.test");
    const https = resolve({ enabled: true, wildcard: { suffix: "preview.test", forHosts: ["dash.test"], scheme: "https" } });
    expect(previewFrameSources("dash.test", 8000, https).join()).not.toContain("preview.test");
  });
});

describe("dashboard CSP header end to end", () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((a) => a.close()));
  });
  it("frame-src follows the request Host; /preview/ and /live/ get no dashboard CSP", async () => {
    const app = Fastify();
    apps.push(app);
    registerCsp(app, "enforce");
    app.get("/", async () => "x");
    app.get("/preview/p/x", async () => "x");
    app.get("/live/p/x", async () => "x");
    await app.ready();
    const page = await app.inject({ url: "/", headers: { host: "localhost:9000" } });
    expect(String(page.headers["content-security-policy"])).toContain("frame-src 'self' https: http://*.localhost:9000;");
    for (const u of ["/preview/p/x", "/live/p/x"]) {
      const r = await app.inject({ url: u, headers: { host: "localhost:9000" } });
      expect(r.headers["content-security-policy"]).toBeUndefined();
    }
  });
});

describe("capability CSP per tier (live-csp)", () => {
  const restricted = { egress: "restricted", scripts: true } as const;
  const origin = "http://k7q4mzxa2bcdefghijklmnopqr.localhost:8000";
  const tier1 = { policy: restricted, host: "k7q4mzxa2bcdefghijklmnopqr.localhost:8000", scheme: "http" as const, prefix: "", origin, ancestors: ["http://localhost:8000"] };
  const dirs = (csp: string) => csp.split("; ");

  it("tiers 1-4: allow-same-origin, exact frame-ancestors (dashboard + capability origin), origin-root lists, frame-src 'self'", () => {
    const d = dirs(buildLiveCsp(tier1)?.csp ?? "");
    expect(d).toContain("sandbox allow-scripts allow-same-origin allow-forms");
    expect(d).toContain(`frame-ancestors http://localhost:8000 ${origin}`);
    expect(d).toContain("frame-src 'self'");
    expect(d).toContain(`connect-src ${origin}/ ws://k7q4mzxa2bcdefghijklmnopqr.localhost:8000/`);
    expect(d).toContain("report-uri /__pi/csp-report");
    expect(d.join()).not.toContain("'self' http"); // no 'self' ancestor, no wildcard
    expect(d.some((x) => x.startsWith("frame-ancestors") && (x.includes("'self'") || x.includes("*")))).toBe(false);
  });
  it("open policy and scripts-off variants", () => {
    expect(buildLiveCsp({ ...tier1, policy: { egress: "open", scripts: true } })?.csp).toBe(
      `sandbox allow-scripts allow-same-origin allow-forms allow-popups allow-downloads; object-src 'none'; frame-ancestors http://localhost:8000 ${origin}`,
    );
    expect(dirs(buildLiveCsp({ ...tier1, policy: { egress: "restricted", scripts: false } })?.csp ?? "")[0]).toBe("sandbox");
  });
  it("https tier 2 uses wss and the entry's scheme, not the request's", () => {
    const o = "https://k7q4mzxa2bcdefghijklmnopqr.preview.example.com";
    const d = dirs(buildLiveCsp({ ...tier1, scheme: "http", host: "k7q4mzxa2bcdefghijklmnopqr.preview.example.com", origin: o, ancestors: ["https://dash.example.com"] })?.csp ?? "");
    expect(d).toContain(`connect-src ${o}/ wss://k7q4mzxa2bcdefghijklmnopqr.preview.example.com/`);
  });
  it("fails closed on an unsafe ancestor (IPv6 literal, path)", () => {
    expect(buildLiveCsp({ ...tier1, ancestors: ["http://[::1]:8000"] })).toBeNull();
    expect(buildLiveCsp({ ...tier1, ancestors: ["http://localhost:8000/x"] })).toBeNull();
  });
  it("tier 5: opaque sandbox, 'self' ancestors, path-scoped lists and frame-src; legacy unchanged", () => {
    const t5 = dirs(buildLiveCsp({ policy: restricted, host: "localhost:8000", scheme: "http", prefix: "/preview/AAAA" })?.csp ?? "");
    expect(t5).toContain("sandbox allow-scripts allow-forms");
    expect(t5).toContain("frame-ancestors 'self'");
    expect(t5).toContain("frame-src http://localhost:8000/preview/AAAA/");
    expect(t5).toContain("report-uri /preview/AAAA/__pi/csp-report");
    const legacy = dirs(buildLiveCsp({ policy: restricted, host: "localhost:8000", scheme: "http", prefix: "/live/x/~c/T" })?.csp ?? "");
    expect(legacy).toContain("frame-src 'none'");
    expect(legacy).toContain("frame-ancestors 'self'");
    expect(legacy.join()).not.toContain("allow-same-origin");
  });
});

const apps2: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(apps2.splice(0).map((a) => a.close()));
});

describe("fail-closed and hostile inputs (E147, E148, E152, X38, X39)", () => {
  it("E147: a hostile Host never injects into frame-src", () => {
    const on = resolve({ enabled: true, portPool: "8100-8199", ipDnsSuffix: "sslip.io" });
    for (const h of ["192.168.1.5:8000; script-src *", "localhost:8000 evil.com", "localhost:80%00", "[::1", "localhost:99999", "1.2.3.4:*", "a/b", "x;y"]) {
      const f = previewFrameSources(h, 8000, on);
      expect(f, h).toEqual([]);
    }
    for (const e of previewFrameSources("192.168.1.5:8000", 8000, on)) expect(e).toMatch(/^http:\/\/(\*\.)?[a-z0-9.-]+(:(\d+|\*))?$/);
  });
  it("E148: only the exact /preview/ and /live/ prefixes are skipped", async () => {
    const app = Fastify();
    apps2.push(app);
    registerCsp(app, "enforce");
    app.get("/*", async () => "x");
    await app.ready();
    const has = async (url: string) => (await app.inject({ url, headers: { host: "localhost:8000" } })).headers["content-security-policy"] !== undefined;
    for (const u of ["/preview/x", "/preview/", "/live/x"]) expect(await has(u), u).toBe(false);
    for (const u of ["/preview", "/previews/", "/Preview/x", "//preview/x", "/preview?x"]) expect(await has(u), u).toBe(true);
  });
  it("E152/X38: unsafe or missing ancestors / origin fail closed (no header)", () => {
    const base = { policy: { egress: "restricted", scripts: true } as const, host: "k7q4mzxa2bcdefghijklmnopqr.localhost:8000", scheme: "http" as const, prefix: "", origin: "http://k7q4mzxa2bcdefghijklmnopqr.localhost:8000" };
    for (const a of ["http://x.com; script-src *", "http://a b", "javascript:1", "http://*.evil", "", "http://[::1]:8000"]) {
      expect(buildLiveCsp({ ...base, ancestors: [a] }), a).toBeNull();
    }
    expect(buildLiveCsp({ ...base, ancestors: [] })).toBeNull();
    expect(buildLiveCsp({ ...base, ancestors: undefined })).toBeNull();
    expect(buildLiveCsp({ ...base, origin: "not an origin", ancestors: ["http://localhost:8000"] })).toBeNull();
    expect(buildLiveCsp({ ...base, ancestors: ["http://localhost:8000", "https://dash.example.com", "http://192.168.1.5:8000"] })?.csp).toContain(
      `frame-ancestors http://localhost:8000 https://dash.example.com http://192.168.1.5:8000 ${base.origin}`,
    );
  });
  it("X39: a failing config read degrades to no preview sources, never throws", () => {
    expect(() => previewFrameSources("localhost:8000", 8000)).not.toThrow();
  });
});
