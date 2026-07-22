/**
 * Route tests for `POST /api/plugins/invoicebot/upload` — the write-side twin of
 * `GET /blob`. Multipart → Buffer[] → `engine.ingest`, per-file outcome, boundary
 * size/count limits, 400 on bad cwd / no file parts, and no flow dispatch.
 * Runs against the Fake engine (the ship-gate binding). See change: add-upload-intake.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeInvoiceEngine } from "../engine/fake.js";
import { mountInvoiceBotRoutes } from "../routes.js";

const BOUNDARY = "----ibtest";
const PDF = Buffer.from("%PDF-1.4\ninvoice", "utf8");
const PDF2 = Buffer.from("%PDF-1.4\nother invoice", "utf8");
const TXT = Buffer.from("plain text, not a document", "utf8");

type Part = { name: string; value: string } | { name: string; filename: string; bytes: Buffer };

/** Build a multipart/form-data body from field + file parts. */
function buildMultipart(parts: Part[]): Buffer {
  const chunks: Buffer[] = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${BOUNDARY}\r\n`));
    if ("filename" in p) {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\n`));
      chunks.push(Buffer.from("Content-Type: application/octet-stream\r\n\r\n"));
      chunks.push(p.bytes);
      chunks.push(Buffer.from("\r\n"));
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${p.name}"\r\n\r\n`));
      chunks.push(Buffer.from(`${p.value}\r\n`));
    }
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(chunks);
}

let app: FastifyInstance;
let cwd: string;

beforeEach(async () => {
  app = Fastify();
  mountInvoiceBotRoutes(app, { engine: new FakeInvoiceEngine(), dispatchFlow: async () => undefined });
  await app.ready();
  cwd = mkdtempSync(join(tmpdir(), "ib-upload-"));
});
afterEach(async () => {
  await app.close();
  rmSync(cwd, { recursive: true, force: true });
});

function upload(parts: Part[]) {
  return app.inject({
    method: "POST",
    url: "/api/plugins/invoicebot/upload",
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
    payload: buildMultipart(parts),
  });
}

describe("upload route — happy path", () => {
  it("valid PDF → 200 landed, no sessionId", async () => {
    const res = await upload([
      { name: "cwd", value: cwd },
      { name: "files", filename: "a.pdf", bytes: PDF },
    ]);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.landed).toBe(1);
    expect(body.results[0]).toMatchObject({ filename: "a.pdf", status: "landed" });
    expect(body.sessionId).toBeUndefined();
  });

  it("disguised/unsupported part → rejected while valid part lands", async () => {
    const res = await upload([
      { name: "cwd", value: cwd },
      { name: "files", filename: "ok.pdf", bytes: PDF },
      { name: "files", filename: "bad.txt", bytes: TXT },
    ]);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const byName = Object.fromEntries(body.results.map((o: any) => [o.filename, o]));
    expect(byName["ok.pdf"].status).toBe("landed");
    expect(byName["bad.txt"].status).toBe("rejected");
    expect(byName["bad.txt"].reason).toMatch(/unsupported/i);
    expect(body).toMatchObject({ landed: 1, rejected: 1 });
  });

  it("same bytes twice → second skipped(duplicate)", async () => {
    const res = await upload([
      { name: "cwd", value: cwd },
      { name: "files", filename: "one.pdf", bytes: PDF },
      { name: "files", filename: "two.pdf", bytes: PDF },
    ]);
    const body = res.json();
    expect(body.results[0].status).toBe("landed");
    expect(body.results[1].status).toBe("skipped");
    expect(body.results[1].reason).toMatch(/duplicate/i);
    expect(body).toMatchObject({ landed: 1, skipped: 1 });
  });
});

describe("upload route — boundary limits", () => {
  it("oversize part → rejected(too large) while a valid part still lands", async () => {
    const huge = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(20 * 1024 * 1024 + 4096, 0x41)]);
    const res = await upload([
      { name: "cwd", value: cwd },
      { name: "files", filename: "big.pdf", bytes: huge },
      { name: "files", filename: "small.pdf", bytes: PDF2 },
    ]);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const byName = Object.fromEntries(body.results.map((o: any) => [o.filename, o]));
    expect(byName["big.pdf"].status).toBe("rejected");
    expect(byName["big.pdf"].reason).toMatch(/too large/i);
    expect(byName["small.pdf"].status).toBe("landed");
  });
});

describe("upload route — input validation", () => {
  it("missing cwd → 400", async () => {
    const res = await upload([{ name: "files", filename: "a.pdf", bytes: PDF }]);
    expect(res.statusCode).toBe(400);
  });

  it("blank cwd → 400", async () => {
    const res = await upload([
      { name: "cwd", value: "   " },
      { name: "files", filename: "a.pdf", bytes: PDF },
    ]);
    expect(res.statusCode).toBe(400);
  });

  it("no file parts → 400", async () => {
    const res = await upload([{ name: "cwd", value: cwd }]);
    expect(res.statusCode).toBe(400);
  });
});
