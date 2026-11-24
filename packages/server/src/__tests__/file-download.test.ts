/**
 * `GET /api/file/raw?download=1` attachment mode + EML attachment on the shared
 * header helper (test-plan #E5–#E10, #X3). See change: add-file-download.
 */
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contentDispositionAttachment } from "../lib/content-disposition.js";
import { clearEmlCache } from "../lib/eml.js";
import { RAW_SANDBOX_CSP, registerFileRoutes } from "../routes/file-routes.js";

function makeApp(cwds: string[]): FastifyInstance {
  const app = Fastify({ logger: false });
  registerFileRoutes(app, {
    sessionManager: { listAll: () => cwds.map((cwd) => ({ cwd })) } as any,
    preferencesStore: { getPinnedDirectories: () => [] } as any,
    networkGuard: async () => undefined,
  });
  return app;
}

describe("GET /api/file/raw — download=1", () => {
  let app: FastifyInstance;
  let cwd: string;
  const q = (p: string, extra = "") =>
    `/api/file/raw?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(p)}${extra}`;

  beforeEach(async () => {
    cwd = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "dl-cwd-")));
    await fsp.mkdir(path.join(cwd, "notes"));
    await fsp.writeFile(path.join(cwd, "notes", "summary.md"), "# hello\n");
    app = makeApp([cwd]);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await fsp.rm(cwd, { recursive: true, force: true });
  });

  it("E5: download=1 → 200, exact bytes, attachment with basename", async () => {
    const res = await app.inject(q("notes/summary.md", "&download=1"));
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("# hello\n");
    expect(res.headers["content-disposition"]).toBe(contentDispositionAttachment("summary.md"));
    expect(res.headers["content-disposition"]).toBe(
      `attachment; filename="summary.md"; filename*=UTF-8''summary.md`,
    );
  });

  it("E6: only the exact value `1` yields attachment", async () => {
    const results: Record<string, string | undefined> = {};
    for (const v of [undefined, "0", "true", "1"]) {
      const res = await app.inject(q("notes/summary.md", v === undefined ? "" : `&download=${v}`));
      results[String(v)] = res.headers["content-disposition"] as string | undefined;
    }
    expect(results).toEqual({
      undefined: "inline",
      "0": "inline",
      true: "inline",
      "1": expect.stringMatching(/^attachment; /),
    });
  });

  it("E7: sandbox CSP + nosniff kept on a scriptable type", async () => {
    await fsp.writeFile(path.join(cwd, "page.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const res = await app.inject(q("page.svg", "&download=1"));
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-security-policy"]).toBe(RAW_SANDBOX_CSP);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="page\.svg"/);
  });

  it("E8: Range kept with download=1 → 206 + content-range + attachment", async () => {
    await fsp.writeFile(path.join(cwd, "big.bin"), Buffer.alloc(4096, 7));
    const res = await app.inject({
      method: "GET",
      url: q("big.bin", "&download=1"),
      headers: { range: "bytes=1024-2047" },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers["content-range"]).toBe("bytes 1024-2047/4096");
    expect(res.headers["content-disposition"]).toMatch(/^attachment; /);
    expect(res.rawPayload.length).toBe(1024);
  });

  it("E9: admission unchanged — unknown cwd and traversal deny identically with and without download", async () => {
    const unknown = (extra: string) =>
      app.inject(`/api/file/raw?cwd=${encodeURIComponent("/unknown-cwd-xyz")}&path=a.txt${extra}`);
    const trav = (extra: string) => app.inject(q("../../../../etc/hosts", extra));

    const [u0, u1] = [await unknown(""), await unknown("&download=1")];
    expect([u1.statusCode, u1.json().code]).toEqual([403, "cwd_unknown"]);
    expect(u1.json()).toEqual(u0.json());

    const [t0, t1] = [await trav(""), await trav("&download=1")];
    expect(t1.statusCode).toBe(403);
    expect(t1.json().error).toBe("path outside working directory");
    expect(t1.json().error).toBe(t0.json().error);
    expect(t1.headers["content-disposition"]).toBeUndefined();
  });

  it("X3: missing file → 404 with no attachment disposition", async () => {
    const res = await app.inject(q("nope.txt", "&download=1"));
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-disposition"]).toBeUndefined();
  });
});

describe("GET /api/file/eml-attachment — shared header helper", () => {
  let app: FastifyInstance;
  let tmp: string;

  beforeEach(async () => {
    clearEmlCache();
    tmp = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "dl-eml-")));
    app = makeApp([tmp]);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("E10: attachment filename with a backslash → `_` in fallback, %5C in filename*", async () => {
    // RFC 2231 `filename*` so the parser sees the literal backslash.
    const eml =
      "From: A <a@example.com>\r\nTo: B <b@example.com>\r\nSubject: s\r\nMIME-Version: 1.0\r\n" +
      'Content-Type: multipart/mixed; boundary="B1"\r\n\r\n' +
      "--B1\r\nContent-Type: text/plain\r\n\r\nhi\r\n" +
      "--B1\r\nContent-Type: text/plain\r\n" +
      "Content-Disposition: attachment; filename*=UTF-8''a%5Cb.txt\r\n" +
      `Content-Transfer-Encoding: base64\r\n\r\n${Buffer.from("x").toString("base64")}\r\n--B1--\r\n`;
    await fsp.writeFile(path.join(tmp, "m.eml"), eml);
    const res = await app.inject(
      `/api/file/eml-attachment?cwd=${encodeURIComponent(tmp)}&path=m.eml&index=0`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toBe(
      `attachment; filename="a_b.txt"; filename*=UTF-8''a%5Cb.txt`,
    );
  });
});
