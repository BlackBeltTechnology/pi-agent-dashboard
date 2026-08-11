/**
 * Route tests for `GET /api/plugins/invoicebot/blob`: content-type + inline +
 * nosniff (3.1), range/206 (3.2), and security status codes 403/404/400 (3.3).
 * See change: serve-invoice-original-blob.
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
const ensureCalls: string[] = [];
const ensureAutomation = async (c: string) => { ensureCalls.push(c); return { automation: [] }; };
const engine: InvoiceEngine = { query: noop, review: noop, setup: noop, rules: noop, ingest: noIngest, ensureAutomation };

let app: FastifyInstance;
let cwd: string;
let outside: string;
let blobsDir: string;
const PDF_BYTES = "%PDF-1.4\n".padEnd(300, "x");
/** Real-world shape: the Hungarian filename that produced 500 ERR_INVALID_CHAR. */
const ACCENTED = "h_Zrt_527_2018_EVOCOM_SzoftverfejlesztőÉsSzolgáltatóBt.pdf";
/** Header-injection probe: quote + CR/LF + backslash inside a legal filename. */
const INJECTION = 'h_ev"il\r\nX-Injected: yes\\slash.pdf';

beforeEach(async () => {
  ensureCalls.length = 0;
  app = Fastify();
  mountInvoiceBotRoutes(app, { engine, dispatchFlow: async () => undefined });
  await app.ready();
  cwd = mkdtempSync(join(tmpdir(), "ib-route-"));
  outside = mkdtempSync(join(tmpdir(), "ib-rout-out-"));
  blobsDir = resolve(cwd, ".pi/flows/invoicebot-state/blobs");
  mkdirSync(blobsDir, { recursive: true });
  writeFileSync(join(blobsDir, "h_invoice.pdf"), PDF_BYTES);
  writeFileSync(join(blobsDir, "h_scan.png"), "PNGDATA");
  writeFileSync(join(blobsDir, "h_notes.bin"), "RAWBYTES");
  writeFileSync(join(blobsDir, ACCENTED), PDF_BYTES);
  writeFileSync(join(blobsDir, INJECTION), PDF_BYTES);
  writeFileSync(join(outside, "secret.txt"), "top secret");
});
afterEach(async () => {
  await app.close();
  for (const d of [cwd, outside]) rmSync(d, { recursive: true, force: true });
});

function get(handle: string, headers: Record<string, string> = {}, c: string = cwd) {
  const url = `/api/plugins/invoicebot/blob?cwd=${encodeURIComponent(c)}&handle=${encodeURIComponent(handle)}`;
  return app.inject({ method: "GET", url, headers });
}

describe("blob route — excluded from ensure-intake-automation", () => {
  it("a blob GET does NOT invoke ensureAutomation", async () => {
    const res = await get("h_invoice.pdf");
    expect(res.statusCode).toBe(200);
    expect(ensureCalls).toHaveLength(0);
  });
});

describe("blob route — content types + headers (3.1)", () => {
  it("serves a PDF inline with nosniff + Accept-Ranges", async () => {
    const res = await get("h_invoice.pdf");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe('inline; filename="h_invoice.pdf"');
    expect(res.headers["accept-ranges"]).toBe("bytes");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-length"]).toBe(String(PDF_BYTES.length));
    expect(res.body).toBe(PDF_BYTES);
  });

  it("serves a PNG image inline", async () => {
    const res = await get("h_scan.png");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
  });

  it("unknown extension → octet-stream", async () => {
    const res = await get("h_notes.bin");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/octet-stream");
  });

  it("accepts a full `blobs/<name>` handle", async () => {
    const res = await get("blobs/h_invoice.pdf");
    expect(res.statusCode).toBe(200);
  });
});

describe("blob route — Content-Disposition encoding (fix-blob-content-disposition-encoding)", () => {
  it("an accented filename is served 200 with an ASCII filename AND filename*=UTF-8''", async () => {
    const res = await get(ACCENTED);

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.body).toBe(PDF_BYTES);

    const cd = String(res.headers["content-disposition"]);
    // No byte outside printable US-ASCII may reach a header value.
    expect(/^[\x20-\x7e]*$/.test(cd)).toBe(true);
    expect(cd.startsWith("inline;")).toBe(true);
    expect(cd).toContain('filename="');
    expect(cd).toContain("filename*=UTF-8''");
    // The accented original survives in the RFC 5987 parameter.
    expect(cd).toContain(encodeURIComponent("ő"));
    expect(cd).toContain(encodeURIComponent("É"));
  });

  it("a plain ASCII filename keeps its verbatim, unchanged form", async () => {
    const res = await get("h_invoice.pdf");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toBe('inline; filename="h_invoice.pdf"');
  });

  it("a header-injection filename is neutralised (no quote/CR/LF/backslash literal)", async () => {
    const res = await get(INJECTION);

    expect(res.statusCode).toBe(200);
    const cd = String(res.headers["content-disposition"]);
    // The value must not be splittable or quote-escapable.
    expect(cd).not.toContain("\r");
    expect(cd).not.toContain("\n");
    expect(cd).not.toContain("\\");
    expect(cd.match(/"/g)?.length).toBe(2); // exactly the fallback's own quotes
    expect(res.headers["x-injected"]).toBeUndefined();
  });

  it("range delivery is unaffected by the encoding", async () => {
    const res = await get(ACCENTED, { range: "bytes=0-99" });
    expect(res.statusCode).toBe(206);
    expect(res.headers["content-range"]).toBe(`bytes 0-99/${PDF_BYTES.length}`);
    expect(res.rawPayload.length).toBe(100);
    expect(String(res.headers["content-disposition"])).toContain("filename*=UTF-8''");
  });
});

describe("blob route — range (3.2)", () => {
  it("Range: bytes=0-99 → 206 + Content-Range + 100 bytes", async () => {
    const res = await get("h_invoice.pdf", { range: "bytes=0-99" });
    expect(res.statusCode).toBe(206);
    expect(res.headers["content-range"]).toBe(`bytes 0-99/${PDF_BYTES.length}`);
    expect(res.headers["content-length"]).toBe("100");
    expect(res.rawPayload.length).toBe(100);
    expect(res.body).toBe(PDF_BYTES.slice(0, 100));
  });

  it("unsatisfiable range → 416 + Content-Range */size", async () => {
    const res = await get("h_invoice.pdf", { range: `bytes=${PDF_BYTES.length + 10}-` });
    expect(res.statusCode).toBe(416);
    expect(res.headers["content-range"]).toBe(`bytes */${PDF_BYTES.length}`);
  });
});

describe("blob route — security (3.3)", () => {
  it("`..` traversal handle → 403", async () => {
    const res = await get("../../../../../../etc/passwd");
    expect(res.statusCode).toBe(403);
  });

  it("absolute-path handle → 403", async () => {
    const res = await get(join(outside, "secret.txt"));
    expect(res.statusCode).toBe(403);
  });

  it("symlink escape → 403", async () => {
    symlinkSync(join(outside, "secret.txt"), join(blobsDir, "escape.pdf"));
    const res = await get("escape.pdf");
    expect(res.statusCode).toBe(403);
  });

  it("absent file → 404", async () => {
    const res = await get("nope.pdf");
    expect(res.statusCode).toBe(404);
  });

  it("missing handle → 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/plugins/invoicebot/blob?cwd=${encodeURIComponent(cwd)}`,
    });
    expect(res.statusCode).toBe(400);
  });

  it("missing cwd → 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/plugins/invoicebot/blob?handle=h_invoice.pdf",
    });
    expect(res.statusCode).toBe(400);
  });
});
