/**
 * Route tests for the two queued-invoice surfaces added by
 * serve-and-start-queued-invoice:
 *   - GET  /api/plugins/invoicebot/blob?invoice_id=<id>  (queued original bytes)
 *   - POST /api/plugins/invoicebot/run-invoice           (start ONE scoped run)
 * Covers the path-confinement rejection and the in-flight refusal — the crux
 * safety properties. The `handle` form staying unchanged is covered by
 * blob-route.test.ts.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EngineResult, InvoiceEngine } from "../engine/port.js";
import { mountInvoiceBotRoutes } from "../routes.js";

const noop = async (): Promise<EngineResult> => ({ content: [{ type: "text", text: "" }], details: {} });
const noIngest = async () => ({ results: [], landed: 0, skipped: 0, rejected: 0 });
const ensureAutomation = async () => ({ automation: [] });
const engine: InvoiceEngine = { query: noop, review: noop, setup: noop, rules: noop, ingest: noIngest, ensureAutomation };

const PDF_BYTES = "%PDF-1.4\n".padEnd(300, "x");
const INV_ID = "d896bc0a90942348"; // content-hash shape
const DROP_NAME = `${INV_ID}_Zrt_533_2018_T-PaxKft.pdf`;

let app: FastifyInstance;
let cwd: string;
let outside: string;
let dropDir: string;
/** Records what run-invoice was asked, and a scripted response. */
let runInvoiceCalls: Array<{ cwd: string; invoiceId: string }>;
let runInvoiceImpl: (cwd: string, invoiceId: string) => Promise<{ ok: boolean; runId?: string; reason?: string; error?: string } | undefined>;

beforeEach(async () => {
  runInvoiceCalls = [];
  runInvoiceImpl = async (c, id) => {
    runInvoiceCalls.push({ cwd: c, invoiceId: id });
    return { ok: true, runId: "2026-01-01-000000-invoicebot-intake-00001" };
  };
  app = Fastify();
  mountInvoiceBotRoutes(app, {
    engine,
    dispatchFlow: async () => undefined,
    runInvoice: (c, id) => runInvoiceImpl(c, id),
  });
  await app.ready();
  cwd = mkdtempSync(join(tmpdir(), "ib-runq-"));
  outside = mkdtempSync(join(tmpdir(), "ib-runq-out-"));
  dropDir = resolve(cwd, ".pi/flows/invoicebot-state/drop");
  mkdirSync(dropDir, { recursive: true });
  writeFileSync(join(dropDir, DROP_NAME), PDF_BYTES);
  writeFileSync(join(outside, "secret.pdf"), "top secret");
});
afterEach(async () => {
  await app.close();
  for (const d of [cwd, outside]) rmSync(d, { recursive: true, force: true });
});

function getById(invoiceId: string, headers: Record<string, string> = {}, c: string = cwd) {
  const url = `/api/plugins/invoicebot/blob?cwd=${encodeURIComponent(c)}&invoice_id=${encodeURIComponent(invoiceId)}`;
  return app.inject({ method: "GET", url, headers });
}
function runInvoice(body: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/api/plugins/invoicebot/run-invoice", payload: body });
}

describe("blob?invoice_id — queued original delivery", () => {
  it("serves the drop original inline as PDF (200)", async () => {
    const res = await getById(INV_ID);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe(`inline; filename="${DROP_NAME}"`);
    expect(res.headers["accept-ranges"]).toBe("bytes");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.body).toBe(PDF_BYTES);
  });

  it("honours a Range request (206)", async () => {
    const res = await getById(INV_ID, { range: "bytes=0-8" });
    expect(res.statusCode).toBe(206);
    expect(res.headers["content-range"]).toBe(`bytes 0-8/${PDF_BYTES.length}`);
    expect(res.body).toBe(PDF_BYTES.slice(0, 9));
  });

  it("404 when the drop file was consumed by processing", async () => {
    rmSync(join(dropDir, DROP_NAME));
    const res = await getById(INV_ID);
    expect(res.statusCode).toBe(404);
  });

  it("404 for an unknown invoice id", async () => {
    const res = await getById("0000000000000000");
    expect(res.statusCode).toBe(404);
  });

  it("400 when neither handle nor invoice_id is supplied", async () => {
    const res = await app.inject({ method: "GET", url: `/api/plugins/invoicebot/blob?cwd=${encodeURIComponent(cwd)}` });
    expect(res.statusCode).toBe(400);
  });

  describe("path-confinement rejection", () => {
    for (const bad of ["../secret", "..%2Fsecret", "a/b", "a\\b", "/etc/passwd", "a.b", "~root"]) {
      it(`rejects traversal-shaped invoice_id ${JSON.stringify(bad)} (not 200)`, async () => {
        const res = await getById(bad);
        expect(res.statusCode).not.toBe(200);
        expect([400, 403, 404]).toContain(res.statusCode);
      });
    }

    it("rejects a symlink whose target escapes the state dir", async () => {
      const link = join(dropDir, `${INV_ID}_link.pdf`);
      // remove the real drop file so the symlink is the only `<id>_` match
      rmSync(join(dropDir, DROP_NAME));
      symlinkSync(join(outside, "secret.pdf"), link);
      const res = await getById(INV_ID);
      expect(res.statusCode).not.toBe(200);
      expect([403, 404]).toContain(res.statusCode);
    });
  });
});

describe("run-invoice route", () => {
  it("starts exactly one run and returns its runId", async () => {
    const res = await runInvoice({ cwd, invoice_id: INV_ID });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, runId: expect.any(String) });
    expect(runInvoiceCalls).toEqual([{ cwd, invoiceId: INV_ID }]);
  });

  it("refuses with 409 / reason:in_flight when the invoice already runs", async () => {
    runInvoiceImpl = async () => ({ ok: false, reason: "in_flight" });
    const res = await runInvoice({ cwd, invoice_id: INV_ID });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, reason: "in_flight" });
  });

  it("400 when invoice_id is missing", async () => {
    const res = await runInvoice({ cwd });
    expect(res.statusCode).toBe(400);
    expect(runInvoiceCalls).toHaveLength(0);
  });

  it("400 when cwd is missing", async () => {
    const res = await runInvoice({ invoice_id: INV_ID });
    expect(res.statusCode).toBe(400);
  });

  it("503 when the automation:runInvoice service is unavailable", async () => {
    await app.close();
    app = Fastify();
    mountInvoiceBotRoutes(app, { engine, dispatchFlow: async () => undefined }); // no runInvoice dep
    await app.ready();
    const res = await runInvoice({ cwd, invoice_id: INV_ID });
    expect(res.statusCode).toBe(503);
  });

  it("503 when the service resolves undefined (not yet published)", async () => {
    runInvoiceImpl = async () => undefined;
    const res = await runInvoice({ cwd, invoice_id: INV_ID });
    expect(res.statusCode).toBe(503);
  });
});
