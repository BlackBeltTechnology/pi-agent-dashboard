/**
 * Baseline CSP report sink over a REAL socket: chunked bodies, a body read that must stop at
 * the cap, an aborted body, and a trickling (slow) body. `fastify.inject` cannot express these.
 * Test ids refer to openspec/changes/harden-cors-and-csp-reporting/test-plan.md.
 *
 * See change: harden-cors-and-csp-reporting (D8).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerCspReportSink } from "../auth/csp-report-sink.js";
import { CspReportStore } from "../auth/csp-report-store.js";
import { type RawResult, rawRequest } from "../test-support/raw-http-client.js";

const CT = "application/csp-report";

interface Ctx {
  app: FastifyInstance;
  store: CspReportStore;
  port: number;
  reads: number[];
}

let dir: string;
let ctx: Ctx;
const rejections: unknown[] = [];
const onRejection = (e: unknown) => rejections.push(e);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "csp-sink-sock-"));
  rejections.length = 0;
  process.on("unhandledRejection", onRejection);
});
afterEach(async () => {
  process.off("unhandledRejection", onRejection);
  await ctx?.app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Every `take` sees a clock a second later, so one loopback peer is never rate limited in a test. */
async function start(): Promise<Ctx> {
  const app = Fastify({ logger: false });
  const store = new CspReportStore({ filePath: path.join(dir, "csp-reports.json"), warn: () => {} });
  let t = 1_700_000_000_000;
  const reads: number[] = [];
  registerCspReportSink(app, {
    store,
    networkGuard: async () => {},
    now: () => (t += 1_000),
    log: () => {},
    onBodyRead: (n) => reads.push(n),
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const port = (app.server.address() as { port: number }).port;
  ctx = { app, store, port, reads };
  return ctx;
}

const valid = (directive = "script-src-elem") => JSON.stringify({ "csp-report": { "effective-directive": directive } });
const kib = (n: number, byte = "a") => Buffer.alloc(n * 1024, byte);
const report = (c: Ctx, extra: Partial<Parameters<typeof rawRequest>[0]> = {}) =>
  rawRequest({ port: c.port, path: "/__pi/csp-report/strict", headers: { "content-type": CT }, ...extra });

/** A valid JSON body padded to `bytes`, cut into `parts` chunk sizes. */
function chunksOfExactly(sizes: number[]): Buffer[] {
  const total = sizes.reduce((a, b) => a + b, 0);
  const head = '{"csp-report":{"effective-directive":"script-src-elem","pad":"';
  const tail = '"}}';
  const body = head + "x".repeat(total - head.length - tail.length) + tail;
  const out: Buffer[] = [];
  let at = 0;
  for (const s of sizes) {
    out.push(Buffer.from(body.slice(at, at + s)));
    at += s;
  }
  return out;
}

describe("real-socket sink behaviour", () => {
  it("WE25: chunked bodies — 8192 B accepted, 8193 B refused 413 (dropped +1), a 1 MiB stream is cut at the cap", async () => {
    const c = await start();
    const a = await report(c, { chunks: chunksOfExactly([4096, 4096]) }).done;
    expect(a.status).toBe(204);
    expect(c.store.snapshot().counts.strict["script-src-elem"]).toBe(1);

    const b = await report(c, { chunks: chunksOfExactly([4096, 4097]) }).done;
    expect(b.status).toBe(413);
    expect(c.store.snapshot().dropped).toBe(1);
    expect(c.store.snapshot().counts.strict["script-src-elem"]).toBe(1);

    const total = 1024 * 1024;
    const stream = (function* () {
      const chunk = Buffer.alloc(1024, "a");
      for (let i = 0; i < total / 1024; i++) yield chunk;
    })();
    const big = await report(c, { chunks: stream, chunkDelayMs: 1 }).done;
    expect(big.status).toBe(413);
    expect(big.writtenAtResponse).toBeLessThan(total); // answered before the sender finished
    expect(c.store.snapshot().dropped).toBe(2);
  }, 30_000);

  it("WP3: 200 oversize bodies (64 KiB) and 20 concurrent 10 MiB chunked streams → 413 each, bounded read, dropped = 220", async () => {
    const c = await start();
    for (let i = 0; i < 200; i++) {
      const r = await report(c, { headers: { "content-type": CT, "content-length": 64 * 1024 }, chunks: [kib(64)] }).done;
      expect(r.status, `#${i}`).toBe(413);
    }
    const streams = Array.from({ length: 20 }, () => {
      const gen = (function* () {
        const chunk = Buffer.alloc(1024, "b");
        for (let i = 0; i < 10 * 1024; i++) yield chunk;
      })();
      return report(c, { chunks: gen, chunkDelayMs: 0 }).done;
    });
    const results: RawResult[] = await Promise.all(streams);
    for (const r of results) expect(r.status).toBe(413);
    expect(c.reads).toHaveLength(220);
    for (const n of c.reads) expect(n).toBeLessThanOrEqual(8192 + 1024 + 1);
    expect(c.store.snapshot().dropped).toBe(220);
    expect(Object.keys(c.store.snapshot().counts.strict)).toHaveLength(0);
    const follow = await report(c, { headers: { "content-type": CT }, chunks: [valid()] }).done;
    expect(follow.status).toBe(204);
  }, 120_000);

  it("WX1: a client that aborts mid-body changes nothing; the server stays up", async () => {
    const c = await start();
    const aborted = report(c, { headers: { "content-type": CT, "content-length": 6000 }, chunks: [kib(4)], abortAfterChunks: true });
    await aborted.done.catch(() => {});
    await new Promise((r) => setTimeout(r, 200));
    expect(c.store.snapshot().dropped).toBe(0);
    expect(Object.keys(c.store.snapshot().counts.strict)).toHaveLength(0);
    const follow = await report(c, { chunks: [valid()] }).done;
    expect(follow.status).toBe(204);
    expect(c.store.snapshot().counts.strict["script-src-elem"]).toBe(1);
    expect(rejections).toEqual([]);
  }, 20_000);

  it("WX7: a trickling body is cut at the 5 s deadline → 408, dropped +1, connection released", async () => {
    const c = await start();
    const trickle = (function* () {
      for (let i = 0; i < 40; i++) yield Buffer.from("x");
    })();
    const slow = report(c, { headers: { "content-type": CT, "content-length": 4000 }, chunks: trickle, chunkDelayMs: 500 });
    const r = await slow.done;
    expect(r.status).toBe(408);
    expect(r.responseAfterMs).toBeGreaterThanOrEqual(4_900);
    expect(r.responseAfterMs).toBeLessThan(8_000);
    expect(c.store.snapshot().dropped).toBe(1);
    expect(Object.keys(c.store.snapshot().counts.strict)).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const open = await new Promise<number>((resolve) => c.app.server.getConnections((_e, n) => resolve(n)));
    expect(open).toBe(0);
    const follow = await report(c, { chunks: [valid()] }).done;
    expect(follow.status).toBe(204);
  }, 30_000);
});
