/**
 * Baseline CSP report sink + persisted counter + operator reset (L1, `fastify.inject`).
 * Test ids refer to openspec/changes/archive/2026-10-23-harden-cors-and-csp-reporting/test-plan.md.
 * Real-socket cases (WE25, WP3, WX1, WX7) live in `csp-report-sink-socket.test.ts`.
 *
 * See change: harden-cors-and-csp-reporting (D8).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import zlib from "node:zlib";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CSP_REPORT_POLICIES, type CspReportPolicy, cspReportPath } from "../auth/csp-report-paths.js";
import { registerCspReportSink } from "../auth/csp-report-sink.js";
import {
  CSP_DIRECTIVE_ALLOW_SET,
  CspReportStore,
  SHADOW_OUTCOMES,
  strictScriptSrcMeasure,
} from "../auth/csp-report-store.js";
import { registerCspReportParsers } from "../live-server/live-csp-report.js";
import { registerCspViolationRoutes } from "../routes/csp-violations-routes.js";

const CT = "application/csp-report";
const CT_API = "application/reports+json";

interface Ctx {
  app: FastifyInstance;
  store: CspReportStore;
  file: string;
  clock: { t: number };
  logs: string[];
  warns: string[];
  handle: { trackedPeers(): number };
}

let dir: string;
const apps: FastifyInstance[] = [];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "csp-sink-"));
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const a of apps.splice(0)) await a.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

interface BuildOpts {
  live?: "before" | "after";
  globalLimiter?: boolean;
  spaFallback?: boolean;
  clock?: { t: number };
  file?: string;
}

async function build(o: BuildOpts = {}): Promise<Ctx> {
  const clock = o.clock ?? { t: 1_700_000_000_000 };
  const file = o.file ?? path.join(dir, "csp-reports.json");
  const warns: string[] = [];
  const logs: string[] = [];
  const app = Fastify({ logger: false });
  apps.push(app);
  const store = new CspReportStore({ filePath: file, now: () => clock.t, warn: (m) => warns.push(m) });
  if (o.globalLimiter) {
    await app.register(rateLimit, { global: true, max: 100_000, timeWindow: "1 minute", allowList: ["127.0.0.1", "::1"] });
  }
  const liveRoute = () => {
    registerCspReportParsers(app);
    app.post("/live/:id/__pi/csp-report", async (_req, reply) => reply.code(204).send());
  };
  if (o.live === "before") liveRoute();
  const handle = registerCspReportSink(app, {
    store,
    networkGuard: async (req, reply) => {
      if (!req.headers["x-auth"]) await reply.code(401).send({ success: false });
    },
    now: () => clock.t,
    log: (m) => logs.push(m),
  });
  if (o.live === "after") liveRoute();
  registerCspViolationRoutes(app, { networkGuard: async () => {}, principalOf: () => "p", recordShadow: (o, n) => store.recordShadow(o, n) });
  if (o.spaFallback) app.setNotFoundHandler((_req, reply) => reply.code(200).type("text/html").send("<html>spa</html>"));
  await app.ready();
  return { app, store, file, clock, logs, warns, handle };
}

let peerSeq = 0;
const peerIp = (i: number) => `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;
const freshPeer = () => peerIp(++peerSeq + 1000);

const report = (directive = "script-src-elem", extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    "csp-report": {
      "document-uri": "https://h.example/settings/security?token=secret",
      "effective-directive": directive,
      "violated-directive": `${directive} 'self'`,
      "blocked-uri": "inline",
      ...extra,
    },
  });

/** A valid report body of EXACTLY `bytes` UTF-8 bytes (padding with `fill`, ASCII-filled to the byte). */
function reportOfBytes(bytes: number, fill = "x"): string {
  const make = (pad: string) =>
    JSON.stringify({ "csp-report": { "effective-directive": "script-src-elem", pad } });
  const base = Buffer.byteLength(make(""));
  const need = bytes - base;
  const w = Buffer.byteLength(fill);
  const pad = fill.repeat(Math.floor(need / w)) + "x".repeat(need % w);
  const out = make(pad);
  expect(Buffer.byteLength(out)).toBe(bytes);
  return out;
}

function post(
  c: Ctx,
  label: string,
  payload: string | Buffer,
  opts: { type?: string | null; peer?: string; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.type !== null) headers["content-type"] = opts.type ?? CT;
  return c.app.inject({
    method: "POST",
    url: `/__pi/csp-report/${label}`,
    remoteAddress: opts.peer ?? freshPeer(),
    headers,
    payload,
  });
}

const sumCounts = (c: Ctx) =>
  CSP_REPORT_POLICIES.reduce((n, p) => n + Object.values(c.store.snapshot().counts[p]).reduce((a, b) => a + b, 0), 0);

/** A worker thread that re-reads and parses `file` every ~1 ms until stopped; counts torn (unparseable) reads. */
function startTornReadWatcher(file: string): { stop(): Promise<{ bad: number; reads: number }> } {
  const reader = new Worker(
    `const fs=require("node:fs");const {parentPort,workerData}=require("node:worker_threads");
     let bad=0,reads=0,stop=false;
     parentPort.on("message",()=>{stop=true;});
     (function tick(){ if(stop){parentPort.postMessage({bad,reads});return;}
       try{const t=fs.readFileSync(workerData.file,"utf8");reads++;JSON.parse(t);}catch(e){ if(e.code!=="ENOENT")bad++; }
       setTimeout(tick,1);})();`,
    { eval: true, workerData: { file } },
  );
  const result = new Promise<{ bad: number; reads: number }>((resolve) => reader.once("message", resolve));
  return {
    stop: async () => {
      reader.postMessage("stop");
      const r = await result;
      await reader.terminate();
      return r;
    },
  };
}

/** The persisted file carries exactly the in-memory counts and `dropped` (no lost update). */
function expectFileMatchesMemory(c: Ctx): void {
  const onDisk = JSON.parse(fs.readFileSync(c.file, "utf8"));
  const mem = c.store.snapshot();
  for (const p of CSP_REPORT_POLICIES) {
    const disk = Object.fromEntries(Object.entries(onDisk.counts[p] as Record<string, { count: number }>).map(([k, v]) => [k, v.count]));
    expect(disk, p).toEqual(mem.counts[p as CspReportPolicy]);
  }
  expect(onDisk.dropped).toBe(mem.dropped);
}

/** 5,000 reports from 250 peers across 10 s of fake time with an explicit flush every 100; returns the file modes seen. */
async function hammerWithFlushes(c: Ctx): Promise<number[]> {
  const peers = Array.from({ length: 250 }, (_, i) => peerIp(4_000_000 + i));
  const modes: number[] = [];
  for (let i = 0; i < 5_000; i++) {
    const label: CspReportPolicy = i % 2 ? "strict" : "baseline";
    await post(c, label, report(i % 3 ? "script-src-elem" : "img-src"), { peer: peers[i % 250] });
    if (i % 100 === 99) c.store.flush();
    if (i % 500 === 499) await vi.advanceTimersByTimeAsync(1_000);
    if (i % 500 === 499 && process.platform !== "win32") modes.push(fs.statSync(c.file).mode & 0o777);
  }
  return modes;
}

describe("sink acceptance and content types", () => {
  it("WE22: only the two report media types are accepted; everything else is 415 and uncounted", async () => {
    const c = await build();
    const cases: Array<[string | null, number]> = [
      ["application/csp-report", 204],
      ["application/reports+json", 204],
      ["application/csp-report; charset=utf-8", 204],
      ["APPLICATION/CSP-REPORT", 204],
      ["application/json", 415],
      ["text/plain", 415],
      ["application/x-www-form-urlencoded", 415],
      ["multipart/form-data; boundary=x", 415],
      [null, 415],
      ["application/csp-reportx", 415],
      ["application/reports+json2", 415],
    ];
    let accepted = 0;
    for (const [type, status] of cases) {
      const before = c.store.snapshot();
      const res = await post(c, "baseline", report(), { type });
      expect(res.statusCode, String(type)).toBe(status);
      if (status === 204) {
        accepted++;
        expect(res.body).toBe("");
      } else {
        expect(c.store.snapshot()).toEqual(before);
      }
    }
    expect(c.store.snapshot().counts.baseline["script-src-elem"]).toBe(accepted);
    expect(c.store.snapshot().dropped).toBe(0);
  });

  it("Reporting API array and legacy report are both accepted (204, empty body)", async () => {
    const c = await build();
    const api = JSON.stringify([{ type: "csp-violation", body: { effectiveDirective: "img-src" } }]);
    expect((await post(c, "baseline", api, { type: CT_API })).statusCode).toBe(204);
    expect((await post(c, "strict", report(), { type: CT })).statusCode).toBe(204);
    expect(c.store.snapshot().counts.baseline["img-src"]).toBe(1);
    expect(c.store.snapshot().counts.strict["script-src-elem"]).toBe(1);
  });

  it("WE23: any label outside baseline|strict|trusted-types is 404 and counts nothing", async () => {
    const c = await build();
    for (const label of ["other", "Strict", "strict.json", "baseline%00", "__proto__", "constructor", "trusted_types", ""]) {
      const res = await post(c, label, report());
      expect(res.statusCode, JSON.stringify(label)).toBe(404);
      const text = JSON.stringify(res.headers) + res.body;
      if (label) for (const frag of [label, decodeURIComponent(label.replace(/%00/g, ""))]) if (frag) expect(text).not.toContain(frag);
    }
    expect(sumCounts(c)).toBe(0);
    expect(c.store.snapshot().dropped).toBe(0);
  });

  it("the sink path wins over the SPA fallback; the SPA fallback still serves other unmatched routes", async () => {
    const c = await build({ spaFallback: true });
    expect((await post(c, "strict", report())).statusCode).toBe(204);
    const other = await c.app.inject({ method: "GET", url: "/settings/security" });
    expect(other.body).toContain("spa");
  });
});

describe("sink size cap", () => {
  it("WE24: 8191 / 8192 accepted, 8193 / multibyte-8194 refused 413 with dropped +1", async () => {
    const c = await build();
    expect((await post(c, "strict", reportOfBytes(8191))).statusCode).toBe(204);
    expect((await post(c, "strict", reportOfBytes(8192))).statusCode).toBe(204);
    expect((await post(c, "strict", reportOfBytes(8192, "é"))).statusCode).toBe(204);
    expect(c.store.snapshot().counts.strict["script-src-elem"]).toBe(3);
    expect(c.store.snapshot().dropped).toBe(0);
    expect((await post(c, "strict", reportOfBytes(8193))).statusCode).toBe(413);
    const multibyte = reportOfBytes(8194, "é");
    expect(multibyte.length).toBeLessThan(8192);
    expect((await post(c, "strict", multibyte)).statusCode).toBe(413);
    expect(c.store.snapshot().counts.strict["script-src-elem"]).toBe(3);
    expect(c.store.snapshot().dropped).toBe(2);
  });

  it("WE46: an understated Content-Length does not bypass the cap (measured by the actual body)", async () => {
    const c = await build();
    const res = await post(c, "strict", reportOfBytes(9216), { headers: { "content-length": "100" } });
    expect(res.statusCode).toBe(413);
    expect(c.store.snapshot().dropped).toBe(1);
    expect(sumCounts(c)).toBe(0);
  });

  it("WE26: the 8 KiB cap holds and the live sink keeps its 64 KiB cap, in either registration order", async () => {
    for (const live of ["before", "after"] as const) {
      const c = await build({ live, spaFallback: true });
      const sink = await post(c, "strict", reportOfBytes(8193));
      expect(sink.statusCode, `${live}: sink 413`).toBe(413);
      expect((await post(c, "strict", reportOfBytes(8192))).statusCode, `${live}: sink 204`).toBe(204);
      const liveUrl = "/live/abc/__pi/csp-report";
      const livePost = (n: number) =>
        c.app.inject({ method: "POST", url: liveUrl, headers: { "content-type": CT }, payload: reportOfBytes(n) });
      expect((await livePost(8193)).statusCode, `${live}: live 8193`).toBe(204);
      expect((await livePost(65536)).statusCode, `${live}: live 65536`).toBe(204);
      expect((await livePost(65537)).statusCode, `${live}: live 65537`).toBe(413);
    }
  });
});

describe("sink rate limiter", () => {
  it("WE27: per socket peer; forwarded headers cannot change the key", async () => {
    const c = await build();
    const A = "203.0.113.5";
    const B = "203.0.113.6";
    for (let i = 0; i < 20; i++) expect((await post(c, "strict", report(), { peer: A })).statusCode, `A#${i + 1}`).toBe(204);
    expect((await post(c, "strict", report(), { peer: A })).statusCode).toBe(429);
    expect(c.store.snapshot().dropped).toBe(1);
    expect(c.store.snapshot().counts.strict["script-src-elem"]).toBe(20);
    expect((await post(c, "strict", report(), { peer: B })).statusCode).toBe(204);
    for (const h of [{ "x-forwarded-for": "198.51.100.1" }, { forwarded: "for=198.51.100.2" }, { "x-forwarded-for": "198.51.100.3" }] as Array<Record<string, string>>) {
      expect((await post(c, "strict", report(), { peer: A, headers: h })).statusCode).toBe(429);
    }
  });

  it("WE28: loopback peers are not exempt, even with a global limiter that allow-lists them", async () => {
    const c = await build({ globalLimiter: true });
    for (const peer of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      const before = c.store.snapshot().dropped;
      for (let i = 0; i < 20; i++) expect((await post(c, "strict", report(), { peer })).statusCode, `${peer}#${i + 1}`).toBe(204);
      expect((await post(c, "strict", report(), { peer })).statusCode, peer).toBe(429);
      expect(c.store.snapshot().dropped, peer).toBe(before + 1);
    }
  });

  it("WE45: bucket of 20, one token refilled per second, never above 20", async () => {
    const c = await build();
    const peer = "203.0.113.5";
    for (let i = 0; i < 20; i++) await post(c, "strict", report(), { peer });
    expect((await post(c, "strict", report(), { peer })).statusCode).toBe(429);
    expect(c.store.snapshot().dropped).toBe(1);
    c.clock.t += 999;
    expect((await post(c, "strict", report(), { peer })).statusCode).toBe(429);
    c.clock.t += 1; // t = 1 s after the drain
    expect((await post(c, "strict", report(), { peer })).statusCode).toBe(204);
    c.clock.t += 20_000;
    for (let i = 0; i < 20; i++) expect((await post(c, "strict", report(), { peer })).statusCode, `burst ${i + 1}`).toBe(204);
    expect((await post(c, "strict", report(), { peer })).statusCode).toBe(429);
    // sustained 1/s is exactly the refill rate: all accepted (= 60/min)
    for (let i = 0; i < 3_600; i++) {
      c.clock.t += 1_000;
      expect((await post(c, "strict", report(), { peer })).statusCode, `sustained ${i}`).toBe(204);
    }
  }, 60_000);

  it("WE48: a Reporting API batch counts every element but costs one token", async () => {
    const c = await build();
    const batch = JSON.stringify([
      { type: "csp-violation", body: { effectiveDirective: "script-src-elem" } },
      { type: "csp-violation", body: { effectiveDirective: "script-src-elem" } },
      { type: "csp-violation", body: { effectiveDirective: "style-src" } },
    ]);
    const peer = "203.0.113.50";
    expect((await post(c, "strict", batch, { type: CT_API, peer })).statusCode).toBe(204);
    expect(c.store.snapshot().counts.strict).toEqual({ "script-src-elem": 2, "style-src": 1 });
    const fresh = "203.0.113.51";
    const codes: number[] = [];
    for (let i = 0; i < 21; i++) codes.push((await post(c, "baseline", batch, { type: CT_API, peer: fresh })).statusCode);
    expect(codes.slice(0, 20).every((s) => s === 204)).toBe(true);
    expect(codes[20]).toBe(429);
    expect(c.store.snapshot().counts.baseline["script-src-elem"]).toBe(40);
    expect(c.store.snapshot().counts.baseline["style-src"]).toBe(20);
  });

  it("WE50: refusal precedence — 404 before 429 before 415 before 413; every request reaching the limiter takes a token", async () => {
    const c = await build();
    const nine = reportOfBytes(9 * 1024);
    const A = "203.0.113.60";
    for (let i = 0; i < 20; i++) await post(c, "strict", report(), { peer: A }); // A exhausted
    expect((await post(c, "other", nine, { type: "application/json", peer: A })).statusCode).toBe(404);
    expect((await post(c, "strict", nine, { type: "application/json", peer: A })).statusCode).toBe(429);
    expect((await post(c, "strict", nine, { type: CT, peer: A })).statusCode).toBe(429);
    const B = "203.0.113.61";
    expect((await post(c, "other", report(), { peer: B })).statusCode).toBe(404); // takes no token
    expect((await post(c, "strict", nine, { type: "application/json", peer: B })).statusCode).toBe(415);
    expect((await post(c, "strict", nine, { type: CT, peer: B })).statusCode).toBe(413);
    for (let i = 0; i < 18; i++) expect((await post(c, "strict", nine, { type: "application/json", peer: B })).statusCode).toBe(415);
    // B used 1 (415) + 1 (413) + 18 (415) = 20 tokens: the next valid report is limited
    expect((await post(c, "strict", report(), { peer: B })).statusCode).toBe(429);
  });

  it("WP1: 1,000 reports from one peer in a tight loop → 20 × 204 and 980 × 429, one limiter entry", async () => {
    const c = await build();
    const peer = "203.0.113.70";
    const codes: number[] = [];
    for (let i = 0; i < 1_000; i++) codes.push((await post(c, "strict", report(), { peer })).statusCode);
    expect(codes.filter((s) => s === 204)).toHaveLength(20);
    expect(codes.filter((s) => s === 429)).toHaveLength(980);
    expect(c.store.snapshot().dropped).toBe(980);
    expect(sumCounts(c)).toBe(20);
    expect(c.handle.trackedPeers()).toBe(1);
  }, 60_000);

  it("WP2: 10,000 distinct peers, one report each → all accepted", async () => {
    const c = await build();
    for (let i = 0; i < 10_000; i++) {
      const res = await post(c, "baseline", report(), { peer: peerIp(500_000 + i) });
      if (res.statusCode !== 204) throw new Error(`peer ${i} → ${res.statusCode}`);
    }
    expect(sumCounts(c)).toBe(10_000);
    expect(c.store.snapshot().dropped).toBe(0);
  }, 120_000);

  it("WP5: full + idle peers are evicted by the sweep; a peer below capacity is kept; a returner gets a full bucket", async () => {
    const c = await build();
    const peers = Array.from({ length: 10_000 }, (_, i) => peerIp(2_000_000 + i));
    for (const p of peers) await post(c, "baseline", report(), { peer: p });
    const Z = "203.0.113.80";
    for (let i = 0; i < 21; i++) await post(c, "baseline", report(), { peer: Z });
    expect(c.handle.trackedPeers()).toBe(10_001);
    c.clock.t += 21_000;
    await post(c, "baseline", report(), { peer: "203.0.113.81" }); // triggers the sweep
    expect(c.handle.trackedPeers()).toBe(1);
    // a peer still below capacity at the next sweep is retained
    const S = "203.0.113.82";
    for (let i = 0; i < 15; i++) await post(c, "baseline", report(), { peer: S });
    c.clock.t += 1_000;
    await post(c, "baseline", report(), { peer: "203.0.113.83" }); // sweep: S has ~6 tokens
    expect(c.handle.trackedPeers()).toBeGreaterThanOrEqual(2);
    // a returning (evicted) peer gets a fresh full bucket of 20
    const R = peers[0] as string;
    for (let i = 0; i < 20; i++) expect((await post(c, "baseline", report(), { peer: R })).statusCode).toBe(204);
    expect((await post(c, "baseline", report(), { peer: R })).statusCode).toBe(429);
  }, 120_000);
});

describe("sink request handling", () => {
  it("WE47: empty / malformed / non-report / content-encoded bodies → 400, uncounted, nothing echoed", async () => {
    const c = await build();
    const bodies: Array<[string, string | Buffer, Record<string, string>]> = [
      ["empty", "", {}],
      ["{", "{", {}],
      ["()", "()", {}],
      ["null", "null", {}],
      ['"x"', '"x"', {}],
      ["123", "123", {}],
      ["{}", "{}", {}],
      ["gzip bomb", zlib.gzipSync(Buffer.alloc(64 * 1024, "a")), { "content-encoding": "gzip" }],
      ["gzip small valid", zlib.gzipSync(report()), { "content-encoding": "gzip" }],
    ];
    for (const [name, payload, headers] of bodies) {
      const res = await post(c, "strict", payload, { headers });
      expect(res.statusCode, name).toBe(400);
      expect(res.body, name).not.toContain("script-src");
    }
    expect(sumCounts(c)).toBe(0);
    expect(c.store.snapshot().dropped).toBe(0);
  });

  it("WE49: directive selection — effective-directive / effectiveDirective / violated-directive token; lowercase; allow-set", async () => {
    const c = await build();
    const p = (r: Record<string, unknown>) => post(c, "strict", JSON.stringify({ "csp-report": r }));
    await p({ "effective-directive": "script-src-elem", "violated-directive": "script-src-elem 'self'" });
    await p({ effectiveDirective: "script-src-elem" });
    await p({ "violated-directive": "script-src-elem 'self'" });
    await p({ "effective-directive": "SCRIPT-SRC-ELEM" });
    expect(c.store.snapshot().counts.strict).toEqual({ "script-src-elem": 4 });
    await p({ "effective-directive": "style-src", "violated-directive": "script-src-elem 'self'" });
    expect(c.store.snapshot().counts.strict["style-src"]).toBe(1);
    expect(c.store.snapshot().counts.strict["script-src-elem"]).toBe(4);
    await p({ "document-uri": "https://h/x" });
    expect(c.store.snapshot().counts.strict.other).toBe(1);
    // Reporting API with a mixed-case violated-directive only
    await post(c, "strict", JSON.stringify([{ type: "csp-violation", body: { "violated-directive": "Script-Src-Elem 'self'" } }]), { type: CT_API });
    expect(c.store.snapshot().counts.strict["script-src-elem"]).toBe(5);
  });

  it("WE51: non-POST methods → 405 + Allow: POST, never the SPA fallback, nothing counted", async () => {
    const c = await build({ spaFallback: true });
    for (const method of ["GET", "PUT", "DELETE", "OPTIONS", "PATCH"] as const) {
      const res = await c.app.inject({ method, url: cspReportPath("strict"), remoteAddress: freshPeer() });
      expect(res.statusCode, method).toBe(405);
      expect(res.headers.allow, method).toBe("POST");
      expect(res.body, method).not.toContain("spa");
    }
    expect(sumCounts(c)).toBe(0);
    expect(c.store.snapshot().dropped).toBe(0);
  });

  it("WE36: no response or log carries any part of an attacker-chosen report; the log line is exactly the allow-set form", async () => {
    const c = await build();
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const hostile = ["<img onerror=1>", "\r\nX-Injected: 1", "${7*7}", "\u001b(31m", "A".repeat(5_000)];
    const fields = ["blocked-uri", "document-uri", "effective-directive", "referrer", "original-policy"];
    const body = JSON.stringify({
      "csp-report": Object.fromEntries(fields.map((f, i) => [f, i === 2 ? `${hostile[2]}` : hostile[i % hostile.length]])),
    });
    // A valid-size report whose fields all carry hostile text (5,000-char strings kept under the cap).
    const small = JSON.stringify({
      "csp-report": Object.fromEntries(fields.map((f) => [f, hostile.slice(0, 4).join("|")])),
    });
    const bigField = JSON.stringify({ "csp-report": { "blocked-uri": hostile[4], "effective-directive": "script-src-elem" } });
    const texts: string[] = [];
    for (const payload of [body, small, bigField]) {
      const res = await post(c, "strict", payload);
      expect(res.statusCode).toBe(204);
      texts.push(JSON.stringify(res.headers) + res.body);
    }
    const everything = texts.join("\n") + c.logs.join("\n") + spies.flatMap((s) => s.mock.calls.map((a) => a.join(" "))).join("\n");
    for (const frag of ["<img", "X-Injected", "7*7", "(31m", "AAAAAAAAAA", "token=secret"]) expect(everything).not.toContain(frag);
    // Throttled: one line per policy × directive; each is exactly the allow-set form.
    expect(c.logs.length).toBeGreaterThan(0);
    for (const line of c.logs) expect(line).toMatch(/^\[csp\] violation policy=strict directive=(script-src-elem|other)$/);
    expect(new Set(c.logs).size).toBe(c.logs.length);
  });
});

describe("counter semantics", () => {
  it("WE29: report text never becomes a counter key; prototype stays clean", async () => {
    const c = await build();
    const protoKeys = Object.getOwnPropertyNames(Object.prototype).sort();
    const names = [
      ...Array.from({ length: 10_000 }, (_, i) => `x-injected-${i}`),
      "__proto__",
      "constructor",
      "hasOwnProperty",
      "<script>alert(1)</script>",
    ];
    let i = 0;
    for (const name of names) {
      const res = await post(c, "strict", report(name), { peer: peerIp(3_000_000 + i++) });
      if (res.statusCode !== 204) throw new Error(`${name} → ${res.statusCode}`);
    }
    await post(c, "strict", report("script-src-elem"), { peer: peerIp(3_999_999) });
    const strict = c.store.snapshot().counts.strict;
    expect(Object.keys(strict).length).toBeLessThanOrEqual(CSP_DIRECTIVE_ALLOW_SET.length + 1);
    expect(strict.other).toBe(names.length);
    expect(strict["script-src-elem"]).toBe(1);
    expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(protoKeys);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  }, 120_000);

  it("WE30: Trusted Types reports never move the strict script-src* measure", async () => {
    const c = await build();
    const measure = () => strictScriptSrcMeasure(c.store.snapshot());
    for (const label of ["baseline", "strict", "trusted-types"] as const) {
      for (const directive of ["script-src-elem", "require-trusted-types-for", "nonsense"]) {
        const before = measure();
        await post(c, label, report(directive));
        const expected = label === "strict" && directive === "script-src-elem" ? before + 1 : before;
        expect(measure(), `${label}/${directive}`).toBe(expected);
      }
    }
    const s = c.store.snapshot().counts;
    expect(s["trusted-types"]["require-trusted-types-for"]).toBe(1);
    expect(s.strict["require-trusted-types-for"]).toBe(1);
    expect(s.baseline["require-trusted-types-for"]).toBe(1);
    expect(s.strict.other).toBe(1);
  });

  it("the document-path breakdown is bounded, query-free and path-only", async () => {
    const c = await build();
    for (let i = 0; i < 30; i++) {
      await post(c, "strict", report("script-src-elem", { "document-uri": `https://h.example/p${i}?secret=1#frag` }));
    }
    const docs = c.store.documentBreakdown().strict;
    expect(Object.keys(docs).length).toBeLessThanOrEqual(21);
    expect(docs.other).toBe(10);
    expect(JSON.stringify(docs)).not.toContain("secret");
    expect(docs["/p0"]).toBe(1);
  });
});

describe("persistence, reset, restart", () => {
  const reopen = (c: Ctx, clock: { t: number }) => new CspReportStore({ filePath: c.file, now: () => clock.t });

  it("WE31: counters (incl. dropped) survive a re-instantiation; reset zeroes them; deleting the file resets; the in-memory client counters are untouched", async () => {
    const c = await build();
    await post(c, "strict", report());
    await post(c, "baseline", report("img-src"));
    await post(c, "strict", reportOfBytes(9000)); // dropped
    const T0 = c.store.snapshot().since;
    c.store.flush();
    // (1) same file → same values and since; file readable only by the owner
    const again = reopen(c, { t: c.clock.t + 60_000 });
    expect(again.snapshot()).toEqual(c.store.snapshot());
    expect(again.snapshot().since).toBe(T0);
    if (process.platform !== "win32") expect(fs.statSync(c.file).mode & 0o777).toBe(0o600);
    // (2) reset twice
    const violations = async () => (await c.app.inject({ method: "GET", url: "/api/csp-violations" })).json();
    await c.app.inject({ method: "POST", url: "/api/csp-violations", headers: { "content-type": "application/json" }, payload: { entries: [{ directive: "require-trusted-types-for", sink: "s", source: "u", count: 1 }] } });
    const inMemoryBefore = await violations();
    c.clock.t += 1_000;
    const r1 = await c.app.inject({ method: "POST", url: "/api/csp-reports/reset", headers: { "x-auth": "op" } });
    expect(r1.statusCode).toBe(200);
    expect(sumCounts(c)).toBe(0);
    expect(c.store.snapshot().dropped).toBe(0);
    expect(Date.parse(r1.json().since)).toBeGreaterThan(Date.parse(T0));
    c.clock.t += 1_000;
    const r2 = await c.app.inject({ method: "POST", url: "/api/csp-reports/reset", headers: { "x-auth": "op" } });
    expect(Date.parse(r2.json().since)).toBeGreaterThanOrEqual(Date.parse(r1.json().since));
    expect(await violations()).toEqual(inMemoryBefore);
    // (3) stop, delete the file, start → zero with a new since
    await c.app.close();
    fs.rmSync(c.file);
    const clock3 = { t: c.clock.t + 5_000 };
    const fresh = reopen(c, clock3);
    expect(sumCounts({ store: fresh } as Ctx)).toBe(0);
    expect(Date.parse(fresh.snapshot().since)).toBe(clock3.t);
    // (4) upgrade path: file present → values and since unchanged
    fresh.record("strict", "script-src-elem");
    fresh.close();
    const upgraded = reopen(c, { t: clock3.t + 1_000_000 });
    expect(upgraded.snapshot()).toEqual(fresh.snapshot());
  });

  it("WE53: reset responds 200 {success:true, since:<ISO>} and zeroes everything incl. dropped; guarded", async () => {
    const c = await build();
    await post(c, "strict", report());
    await post(c, "strict", reportOfBytes(9000));
    const denied = await c.app.inject({ method: "POST", url: "/api/csp-reports/reset" });
    expect(denied.statusCode).toBe(401);
    expect(c.store.snapshot().dropped).toBe(1);
    c.clock.t += 5_000;
    const res = await c.app.inject({ method: "POST", url: "/api/csp-reports/reset", headers: { "x-auth": "op" } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { success: boolean; since: string };
    expect(body.success).toBe(true);
    expect(new Date(body.since).toISOString()).toBe(body.since);
    expect(c.store.snapshot().since).toBe(body.since);
    expect(c.store.snapshot().dropped).toBe(0);
    expect(sumCounts(c)).toBe(0);
  });

  it("E20: reset zeroes the shadow block and aligns the shadow `since` with the core `since`; the operate-tier gate is WE32", async () => {
    const c = await build();
    await post(c, "strict", report());
    c.store.recordShadow("would-alter-html", 4);
    c.store.recordShadow("shadow-error", 1);
    c.clock.t += 5_000;
    const denied = await c.app.inject({ method: "POST", url: "/api/csp-reports/reset" });
    expect(denied.statusCode).toBe(401);
    expect(c.store.snapshot().ttShadow["would-alter-html"]).toBe(4);
    const res = await c.app.inject({ method: "POST", url: "/api/csp-reports/reset", headers: { "x-auth": "op" } });
    expect(res.statusCode).toBe(200);
    const { success, since } = res.json() as { success: boolean; since: string };
    expect(success).toBe(true);
    const snap = c.store.snapshot();
    expect(snap.since).toBe(since);
    expect(snap.ttShadow.since).toBe(since);
    for (const o of SHADOW_OUTCOMES) expect(snap.ttShadow[o], o).toBe(0);
    expect(sumCounts(c)).toBe(0);
  });

  describe("fake clock", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      vi.setSystemTime(1_700_000_000_000);
    });

    const dateClock = () => ({
      get t() {
        return Date.now();
      },
      set t(_v: number) {
        /* driven by the fake system time */
      },
    });

    it("WE52: a change is on disk within 5 s (one write per window); shutdown flushes", async () => {
      const c = await build({ clock: dateClock() });
      const writes = vi.spyOn(fs, "writeFileSync");
      expect(fs.existsSync(c.file)).toBe(false);
      await post(c, "strict", report());
      await vi.advanceTimersByTimeAsync(4_999);
      expect(fs.existsSync(c.file)).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(JSON.parse(fs.readFileSync(c.file, "utf8")).counts.strict["script-src-elem"].count).toBe(1);
      writes.mockClear();
      for (let i = 0; i < 100; i++) await post(c, "baseline", report("img-src"));
      await vi.advanceTimersByTimeAsync(5_000);
      expect(writes).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(writes).toHaveBeenCalledTimes(1); // idle: no further writes
      // graceful shutdown before the debounce elapses
      await post(c, "strict", report("font-src"));
      await vi.advanceTimersByTimeAsync(1_000);
      await c.app.close();
      expect(JSON.parse(fs.readFileSync(c.file, "utf8")).counts.strict["font-src"].count).toBe(1);
    });

    it.each([["EACCES"], ["ENOSPC"]])("WX4: a %s write fault never changes the 204; one warning; the next flush persists everything", async (code) => {
      const c = await build({ clock: dateClock() });
      const real = fs.writeFileSync;
      let fault = true;
      vi.spyOn(fs, "writeFileSync").mockImplementation(((...args: Parameters<typeof fs.writeFileSync>) => {
        if (fault) throw Object.assign(new Error("fault"), { code });
        return real(...args);
      }) as typeof fs.writeFileSync);
      const codes: number[] = [];
      for (let i = 0; i < 3; i++) codes.push((await post(c, "strict", report())).statusCode);
      await vi.advanceTimersByTimeAsync(5_000); // flush fails
      codes.push((await post(c, "strict", report())).statusCode);
      fault = false;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(codes).toEqual([204, 204, 204, 204]);
      expect(c.store.snapshot().counts.strict["script-src-elem"]).toBe(4);
      expect(c.warns).toHaveLength(1);
      expect(JSON.parse(fs.readFileSync(c.file, "utf8")).counts.strict["script-src-elem"].count).toBe(4);
    });

    it("E18: a shadow count is on disk within 5 s; reload keeps it and both `since`s; policy counters and the strict measure are untouched", async () => {
      const c = await build({ clock: dateClock() });
      await post(c, "strict", report("img-src"));
      await vi.advanceTimersByTimeAsync(5_000);
      const coreBefore = JSON.parse(fs.readFileSync(c.file, "utf8")).counts;
      const measureBefore = strictScriptSrcMeasure(c.store.snapshot());
      c.store.recordShadow("would-alter-html", 4);
      await vi.advanceTimersByTimeAsync(4_999);
      expect(JSON.parse(fs.readFileSync(c.file, "utf8")).ttShadow?.counts?.["would-alter-html"]).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      const onDisk = JSON.parse(fs.readFileSync(c.file, "utf8"));
      expect(onDisk.ttShadow.counts["would-alter-html"].count).toBe(4);
      expect(onDisk.counts).toEqual(coreBefore);
      expect(strictScriptSrcMeasure(c.store.snapshot())).toBe(measureBefore);
      const again = new CspReportStore({ filePath: c.file, now: () => Date.now() + 60_000 });
      expect(again.snapshot().ttShadow).toEqual(c.store.snapshot().ttShadow);
      expect(again.snapshot().ttShadow["would-alter-html"]).toBe(4);
      expect(again.snapshot().since).toBe(c.store.snapshot().since);
    });

    it("X1: a counter-file write fault never fails the route; memory keeps the count; exactly one warning", async () => {
      const c = await build({ clock: dateClock() });
      vi.spyOn(fs, "writeFileSync").mockImplementation((() => {
        throw Object.assign(new Error("fault"), { code: "EACCES" });
      }) as typeof fs.writeFileSync);
      const res = await c.app.inject({
        method: "POST",
        url: "/api/csp-violations",
        headers: { "content-type": "application/json" },
        payload: { entries: [], shadow: { "would-block-script": 1 } },
      });
      expect(res.statusCode).toBe(200);
      await vi.advanceTimersByTimeAsync(5_000);
      c.store.flush();
      expect(c.store.snapshot().ttShadow["would-block-script"]).toBe(1);
      expect(c.warns).toHaveLength(1);
    });

    it("WP4: a concurrent reader never sees a torn counter file; the file equals memory after quiesce", async () => {
      const c = await build({ clock: dateClock() });
      const { stop } = startTornReadWatcher(c.file);
      const modes = await hammerWithFlushes(c);
      await vi.advanceTimersByTimeAsync(5_000);
      const { bad, reads } = await stop();
      expect(reads).toBeGreaterThan(0);
      expect(bad).toBe(0);
      expectFileMatchesMemory(c);
      for (const m of modes) expect(m).toBe(0o600);
    }, 120_000);
  });

  describe("WX5: a corrupt counter file at boot", () => {
    it.each([["truncated JSON", '{"version":1,"since":"2026-'], ["garbage bytes", "\u0000\u0001\uffff garbage"], ["empty file", ""]])(
      "%s → moved to .corrupt, zero counters, new since, one warning, fresh valid file after the first flush",
      async (_name, bytes) => {
        const file = path.join(dir, "csp-reports.json");
        fs.writeFileSync(file, bytes);
        const past = new Date(Date.now() - 3_600_000);
        fs.utimesSync(file, past, past);
        const mtime = fs.statSync(file).mtimeMs;
        const c = await build({ file, clock: { t: Date.now() + 1_000 } });
        expect(c.warns).toHaveLength(1);
        expect(sumCounts(c)).toBe(0);
        expect(Date.parse(c.store.snapshot().since)).toBeGreaterThan(mtime);
        expect(fs.readFileSync(`${file}.corrupt`, "utf8")).toBe(bytes);
        expect(fs.existsSync(file)).toBe(false);
        await post(c, "strict", report());
        c.store.flush();
        expect(JSON.parse(fs.readFileSync(file, "utf8")).counts.strict["script-src-elem"].count).toBe(1);
      },
    );
  });

  describe("E19: the shadow block at boot (missing / malformed / unknown key)", () => {
    const CORE_SINCE = "2026-01-01T00:00:00.000Z";
    const SHADOW_SINCE = "2026-02-01T00:00:00.000Z";
    const core = (extra: Record<string, unknown> = {}) => ({
      version: 1,
      since: CORE_SINCE,
      dropped: 2,
      counts: { baseline: {}, strict: { "script-src-elem": { count: 3, firstSeen: CORE_SINCE, lastSeen: CORE_SINCE } }, "trusted-types": {} },
      documents: { baseline: {}, strict: {}, "trusted-types": {} },
      ...extra,
    });
    const START = Date.parse("2026-03-01T00:00:00.000Z");
    const boot = async (content: unknown) => {
      const file = path.join(dir, "csp-reports.json");
      fs.writeFileSync(file, JSON.stringify(content));
      return { file, c: await build({ file, clock: { t: START } }) };
    };

    it("a core-only file (first upgrade / older-server rewrite) keeps the core and starts a new shadow `since`", async () => {
      const { c } = await boot(core());
      const snap = c.store.snapshot();
      expect(snap.since).toBe(CORE_SINCE);
      expect(snap.dropped).toBe(2);
      expect(snap.counts.strict["script-src-elem"]).toBe(3);
      expect(snap.ttShadow.since).toBe(new Date(START).toISOString());
      for (const o of SHADOW_OUTCOMES) expect(snap.ttShadow[o]).toBe(0);
      expect(c.warns).toHaveLength(0);
    });

    it.each([
      ["a non-object block", []],
      ["a known key with a negative count", { since: SHADOW_SINCE, counts: { "would-alter-html": { count: -1, firstSeen: SHADOW_SINCE, lastSeen: SHADOW_SINCE } } }],
    ])("%s → core kept, no .corrupt file, zero shadow with a new `since`, one warning", async (_n, block) => {
      const { c, file } = await boot(core({ ttShadow: block }));
      const snap = c.store.snapshot();
      expect(fs.existsSync(`${file}.corrupt`)).toBe(false);
      expect(snap.since).toBe(CORE_SINCE);
      expect(snap.counts.strict["script-src-elem"]).toBe(3);
      expect(snap.ttShadow.since).toBe(new Date(START).toISOString());
      for (const o of SHADOW_OUTCOMES) expect(snap.ttShadow[o]).toBe(0);
      expect(c.warns).toHaveLength(1);
    });

    it("an unknown outcome key is ignored: known counts and the shadow `since` survive, the unknown key is gone after the next write", async () => {
      const bucket = (n: number) => ({ count: n, firstSeen: SHADOW_SINCE, lastSeen: SHADOW_SINCE });
      const { c, file } = await boot(core({ ttShadow: { since: SHADOW_SINCE, counts: { "would-alter-html": bucket(5), "would-foo": bucket(9) } } }));
      const snap = c.store.snapshot();
      expect(snap.ttShadow.since).toBe(SHADOW_SINCE);
      expect(snap.ttShadow["would-alter-html"]).toBe(5);
      expect(c.warns).toHaveLength(0);
      c.store.recordShadow("shadow-error", 1);
      c.store.flush();
      const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
      expect(Object.keys(onDisk.ttShadow.counts).sort()).toEqual(["shadow-error", "would-alter-html"]);
    });
  });
});
