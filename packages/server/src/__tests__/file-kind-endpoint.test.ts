/**
 * Tests for the `/api/file` file-kind extension: the handler now returns
 * `{ type: "file", kind, mimeType, size, content? }`, with content present
 * only for text-renderable kinds. See change: add-internal-monaco-editor-pane.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { registerFileRoutes } from "../routes/file-routes.js";

/**
 * Task 3.0 / design D7: containment denials gained ADDITIVE remedy fields
 * (`reason`, `hint`, `subject`, `denialId`, `ancestors`). The pre-existing
 * fields are still pinned exactly — `error` is byte-identical and `success` is
 * still `false` — while the additive ones are asserted by SHAPE, because
 * `denialId` is an opaque per-denial UUID. This is strictly more assertion than
 * the previous `toEqual({ success, error })`, never less: no status code and no
 * error string is relaxed.
 */
function expectContainmentDenial(body: any, error: string): void {
  expect(body).toMatchObject({ success: false, error });
  expect(typeof body.reason).toBe("string");
  expect(typeof body.hint).toBe("string");
  expect(typeof body.subject).toBe("string");
  expect(typeof body.denialId).toBe("string");
  expect(body.denialId.length).toBeGreaterThan(0);
  expect(Array.isArray(body.ancestors)).toBe(true);
}


function makeApp(cwds: string[]): FastifyInstance {
  const app = Fastify({ logger: false });
  registerFileRoutes(app, {
    sessionManager: {
      listAll: () => cwds.map((cwd) => ({ cwd })),
    } as any,
    preferencesStore: { getPinnedDirectories: () => [] } as any,
    networkGuard: async () => undefined,
  });
  return app;
}

const fileUrl = (cwd: string, rel: string) =>
  `/api/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(rel)}`;

describe("GET /api/file — file-kind extension", () => {
  let app: FastifyInstance;
  let tmp: string;

  beforeEach(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "file-kind-"));
    app = makeApp([tmp]);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("returns content + kind for a text file", async () => {
    await fsp.writeFile(path.join(tmp, "foo.ts"), "export const x = 1;\n");
    const res = await app.inject({ method: "GET", url: fileUrl(tmp, "foo.ts") });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      type: "file",
      kind: "text",
      mimeType: "text/x.typescript",
      content: "export const x = 1;\n",
    });
    expect(body.data.size).toBe(20);
  });

  it("returns metadata only (no content) for an image file", async () => {
    await fsp.writeFile(path.join(tmp, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    const res = await app.inject({ method: "GET", url: fileUrl(tmp, "logo.png") });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toMatchObject({ type: "file", kind: "image", mimeType: "image/png" });
    expect(body.data.content).toBeUndefined();
  });

  it("classifies a NUL-byte file as binary with no content", async () => {
    await fsp.writeFile(path.join(tmp, "data"), Buffer.from([0x01, 0x00, 0x02, 0x03]));
    const res = await app.inject({ method: "GET", url: fileUrl(tmp, "data") });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toMatchObject({ type: "file", kind: "binary" });
    expect(body.data.content).toBeUndefined();
  });

  it("returns content for a markdown file", async () => {
    await fsp.writeFile(path.join(tmp, "README.md"), "# Title\n");
    const res = await app.inject({ method: "GET", url: fileUrl(tmp, "README.md") });
    const body = res.json();
    expect(body.data).toMatchObject({ type: "file", kind: "markdown", content: "# Title\n" });
  });

  // Content gate widened to `editable` for `.csv` (Monaco Edit over raw CSV),
  // while binary spreadsheets / office / email stay content-less.
  // See change: open-view-command-in-editor-pane (D4, test-plan E10–E12 / X7).

  it("E10 returns content for an editable .csv (spreadsheet)", async () => {
    await fsp.writeFile(path.join(tmp, "data.csv"), "a,b\n1,2\n");
    const res = await app.inject({ method: "GET", url: fileUrl(tmp, "data.csv") });
    const body = res.json();
    expect(body.data).toMatchObject({ type: "file", kind: "spreadsheet", content: "a,b\n1,2\n" });
  });

  it("E11 / X7 OMITS content for a binary .xlsx (editable:false, no bytes-in-JSON leak)", async () => {
    await fsp.writeFile(path.join(tmp, "book.xlsx"), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]));
    const res = await app.inject({ method: "GET", url: fileUrl(tmp, "book.xlsx") });
    const body = res.json();
    expect(body.data).toMatchObject({ type: "file", kind: "spreadsheet" });
    expect(body.data.content).toBeUndefined();
  });

  it("E12 OMITS content for reclassified .docx and .eml", async () => {
    await fsp.writeFile(path.join(tmp, "report.docx"), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    await fsp.writeFile(path.join(tmp, "mail.eml"), "From: a@b\r\nSubject: hi\r\n\r\nbody\r\n");
    for (const [rel, kind] of [["report.docx", "docx"], ["mail.eml", "email"]] as const) {
      const res = await app.inject({ method: "GET", url: fileUrl(tmp, rel) });
      const body = res.json();
      expect(body.data, rel).toMatchObject({ type: "file", kind });
      expect(body.data.content, rel).toBeUndefined();
    }
  });

  it("still lists directories", async () => {
    await fsp.mkdir(path.join(tmp, "sub"));
    await fsp.writeFile(path.join(tmp, "a.txt"), "x");
    const res = await app.inject({ method: "GET", url: fileUrl(tmp, ".") });
    const body = res.json();
    expect(body.data.type).toBe("directory");
    expect(body.data.entries).toEqual(["a.txt", "sub"]);
  });

  it("403s for an unknown cwd", async () => {
    const res = await app.inject({ method: "GET", url: fileUrl("/nope", "foo.ts") });
    expect(res.statusCode).toBe(403);
  });

  it("403s on path traversal", async () => {
    const res = await app.inject({ method: "GET", url: fileUrl(tmp, "../../../etc/passwd") });
    expect(res.statusCode).toBe(403);
    expectContainmentDenial(res.json(), "path outside working directory");
  });
});
