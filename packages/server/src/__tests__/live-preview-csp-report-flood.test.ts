/**
 * `POST /__pi/csp-report` flood on a preview origin (D6): body-size cap enforced, per-token rate limit, an unknown capability
 * never reaches the report handler, per-token state bounded, and the dashboard's own CSP sink is unaffected.
 *
 * SCALED for vitest: ~900 requests over real sockets (sizes 1 B … 1 MiB, valid + junk bodies, valid + unknown labels) instead of
 * 5k req/s for 2 min. The per-token limits (20/s, 600/h) are asserted as bounds derived from the measured wall time.
 *
 * See change: serve-live-previews-on-capability-origin (D6; test-plan #P19).
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerCspReportSink } from "../auth/csp-report-sink.js";
import { CspReportStore } from "../auth/csp-report-store.js";
import { LiveCapabilityStore } from "../live-server/live-capability.js";
import { createReservedHandler } from "../live-server/live-csp-report.js";
import { CSP_REPORT_MAX_BYTES, createPreviewEgress, MAX_BLOCKED_ORIGINS } from "../live-server/live-egress.js";
import type { LiveServerManager } from "../live-server/live-server-manager.js";
import { createPreviewDispatch, previewServerFactory } from "../live-server/preview-dispatch.js";

const CT = "application/csp-report";
const SIZES = [1, 100, 1024, 32 * 1024, CSP_REPORT_MAX_BYTES, CSP_REPORT_MAX_BYTES + 1, 1024 * 1024];

/** A JSON report padded to exactly `size` bytes (a 1-byte body is not JSON at all). */
function body(size: number, i: number): Buffer {
  if (size < 80) return Buffer.alloc(size, "x");
  const head = `{"csp-report":{"blocked-uri":"https://o${i}.example/x","pad":"`;
  const tail = `"}}`;
  return Buffer.from(head + "p".repeat(size - head.length - tail.length) + tail);
}

function post(port: number, host: string, payload: Buffer, urlPath = "/__pi/csp-report"): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: urlPath, method: "POST", headers: { host, "content-type": CT, "content-length": payload.length }, setHost: false, agent: false },
      (res) => {
        let text = "";
        res.on("data", (c) => {
          text += c;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
      },
    );
    req.on("error", () => resolve({ status: 0, body: "" })); // a server that answers 413 early may reset the upload
    req.end(payload);
  });
}

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lp-p19-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("T.P19 / #P19 — CSP report flood on a preview origin", () => {
  it("size cap (413), per-token rate limit (429), unknown label refused before the handler, bounded state, dashboard sink unaffected", async () => {
    const upstream = http.createServer((_req, res) => res.end("ok"));
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
    const upPort = (upstream.address() as AddressInfo).port;
    const manager = {
      get: (id: string) => (id === "vite-5173" ? { id, label: id, host: "127.0.0.1", port: upPort } : undefined),
      getStatic: () => undefined,
      has: () => true,
      use: () => {},
      list: () => [],
    } as unknown as LiveServerManager;
    const store = new LiveCapabilityStore({ isTargetLive: () => true });
    const egress = createPreviewEgress({ getStatic: () => undefined, projectKeyOf: (c) => c, projectGrants: { has: () => false, list: () => [] } as never, allowOnce: () => [] });
    const dispatch = createPreviewDispatch({
      store,
      manager,
      isPeerLocal: () => true,
      proxyDeps: { reservedHandler: createReservedHandler({ egress, log: () => {} }) },
    });
    // the dashboard app behind the dispatching factory, with the REAL dashboard sink beside it
    const front = Fastify({ logger: false, serverFactory: previewServerFactory(() => dispatch) as never });
    const sinkStore = new CspReportStore({ filePath: path.join(tmp, "csp-reports.json"), warn: () => {} });
    registerCspReportSink(front, { store: sinkStore, networkGuard: async () => {}, log: () => {} });
    await dispatch.ready();
    await front.listen({ port: 0, host: "127.0.0.1" });
    const conns = new Set<Socket>();
    front.server.on("connection", (s) => {
      conns.add(s);
      s.on("close", () => conns.delete(s));
    });
    const port = (front.server.address() as AddressInfo).port;
    const minted = store.mint("vite-5173", { kind: "local" }, { preview: { tier: 1, ancestors: ["http://localhost:8000"], buildOrigin: (l) => ({ origin: `http://${l}.localhost:8000`, originHost: `${l}.localhost:8000` }) } });
    const validHost = `${minted.token}.localhost:8000`;
    const unknownHost = `${"z".repeat(26)}.localhost:8000`;
    const dashHost = `localhost:${port}`;

    // dashboard sink baseline
    const sinkBefore = JSON.stringify(sinkStore.snapshot());

    // count JSON.parse over report-sized strings: an unknown capability must never cost a parse
    const realParse = JSON.parse;
    let bigParses = 0;
    const spy = vi.spyOn(JSON, "parse").mockImplementation(((text: string, reviver?: never) => {
      if (typeof text === "string" && text.length > 8_000) bigParses++;
      return realParse(text, reviver);
    }) as typeof JSON.parse);

    // ---- phase 1: ONLY an unknown label, report-sized valid JSON bodies → opaque 403, and the body is never parsed
    for (let i = 0; i < 60; i++) {
      const r = await post(port, unknownHost, body(i % 2 ? 32 * 1024 : CSP_REPORT_MAX_BYTES, i));
      expect(r.status, `unknown #${i}`).toBe(403);
    }
    expect(bigParses, "an unknown capability's report body was JSON-parsed").toBe(0);

    const results: { size: number; unknown: boolean; status: number }[] = [];
    const t0 = Date.now();
    const TOTAL = 900;
    let next = 0;
    const worker = async () => {
      for (;;) {
        const i = next++;
        if (i >= TOTAL) return;
        const size = SIZES[i % SIZES.length];
        const unknown = i % 5 === 4;
        const r = await post(port, unknown ? unknownHost : validHost, body(size, i));
        results.push({ size, unknown, status: r.status });
        if (unknown) expect(r.body === "" || r.body.includes("host_not_allowed") || r.status === 413 || r.status === 0).toBe(true);
      }
    };
    await Promise.all(Array.from({ length: 16 }, worker));
    const elapsedSec = (Date.now() - t0) / 1000;
    spy.mockRestore();

    expect(results).toHaveLength(TOTAL);
    const valid = results.filter((r) => !r.unknown);
    const unknown = results.filter((r) => r.unknown);

    // ---- size cap: anything above 64 KiB is never accepted (413, or a reset of the oversize upload)
    for (const r of valid.filter((x) => x.size > CSP_REPORT_MAX_BYTES)) expect([413, 0], `size ${r.size}`).toContain(r.status);
    // ---- within the cap: accepted (204) or rate limited (429) — never a server error, never 413
    for (const r of valid.filter((x) => x.size <= CSP_REPORT_MAX_BYTES)) expect([204, 429], `size ${r.size}`).toContain(r.status);
    // ---- rate limit is per token: 20 / s and 600 / h bound the accepted reports whatever the flood rate
    const accepted = valid.filter((r) => r.status === 204).length;
    expect(accepted).toBeGreaterThan(0);
    expect(accepted).toBeLessThanOrEqual(600);
    expect(accepted).toBeLessThanOrEqual(Math.ceil(elapsedSec + 1) * 20);
    expect(valid.filter((r) => r.status === 429).length).toBeGreaterThan(0);

    // ---- an unknown capability: never accepted, never the report handler (403 opaque / 413 before it), never 204/429
    for (const r of unknown) expect([403, 413, 0], `size ${r.size}`).toContain(r.status);
    expect(unknown.filter((r) => r.size <= CSP_REPORT_MAX_BYTES).every((r) => r.status === 403)).toBe(true);

    // ---- per-token state stays bounded: the runtime origin set never exceeds its cap however many distinct origins were reported
    const grant = store.lookupByHost(
      (await import("../live-server/preview-origin.js")).hashPreviewKey(minted.token),
      validHost,
      true,
    );
    expect(grant.ok).toBe(true);
    if (grant.ok) {
      const view = await egress.view(grant.grant);
      expect(view.origins.length).toBeLessThanOrEqual(MAX_BLOCKED_ORIGINS);
      expect(view.runtimeChannel).toBe(true);
    }

    // ---- the dashboard CSP sink is unaffected by the preview flood, and still accepts a report
    expect(JSON.stringify(sinkStore.snapshot())).toBe(sinkBefore);
    const dash = await post(port, dashHost, Buffer.from(JSON.stringify({ "csp-report": { "effective-directive": "script-src-elem" } })), "/__pi/csp-report/strict");
    expect(dash.status).toBe(204);
    expect(sinkStore.snapshot().counts.strict["script-src-elem"]).toBe(1);

    for (const c of conns) c.destroy();
    await front.close();
    await dispatch.close();
    store.close();
    await new Promise<void>((r) => upstream.close(() => r()));
  }, 120_000);
});
