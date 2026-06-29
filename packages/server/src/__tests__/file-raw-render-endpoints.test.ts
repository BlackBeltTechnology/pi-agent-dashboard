/**
 * Tests for `/api/file/raw` (binary-safe streaming) and `/api/file/render`
 * (server-side AsciiDoc rendering). See change: render-file-previews.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { registerFileRoutes } from "../routes/file-routes.js";
import { extToContentType } from "../lib/mime-types.js";

const execFileAsync = promisify(execFile);
async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", ["-C", cwd, ...args]);
}

describe("extToContentType (mime-types.ts)", () => {
  it("maps known extensions to their Content-Type", () => {
    expect(extToContentType(".pdf")).toBe("application/pdf");
    expect(extToContentType(".png")).toBe("image/png");
    expect(extToContentType(".jpg")).toBe("image/jpeg");
    expect(extToContentType(".jpeg")).toBe("image/jpeg");
    expect(extToContentType(".gif")).toBe("image/gif");
    expect(extToContentType(".svg")).toBe("image/svg+xml");
    expect(extToContentType(".webp")).toBe("image/webp");
    expect(extToContentType(".mp4")).toBe("video/mp4");
    expect(extToContentType(".webm")).toBe("video/webm");
    expect(extToContentType(".mov")).toBe("video/quicktime");
    expect(extToContentType(".html")).toBe("text/html; charset=utf-8");
    expect(extToContentType(".htm")).toBe("text/html; charset=utf-8");
    expect(extToContentType(".txt")).toBe("text/plain; charset=utf-8");
    expect(extToContentType(".md")).toBe("text/markdown; charset=utf-8");
    expect(extToContentType(".adoc")).toBe("text/asciidoc; charset=utf-8");
    expect(extToContentType(".asciidoc")).toBe("text/asciidoc; charset=utf-8");
  });

  it("is case-insensitive", () => {
    expect(extToContentType(".PDF")).toBe("application/pdf");
    expect(extToContentType(".JPG")).toBe("image/jpeg");
  });

  it("defaults to application/octet-stream for unknowns", () => {
    expect(extToContentType(".dat")).toBe("application/octet-stream");
    expect(extToContentType("")).toBe("application/octet-stream");
  });
});

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

describe("GET /api/file/raw", () => {
  let app: FastifyInstance;
  let tmp: string;

  beforeEach(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "file-raw-"));
    app = makeApp([tmp]);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("403s when cwd is not a known session", async () => {
    const res = await app.inject({ method: "GET", url: "/api/file/raw?cwd=/nope&path=foo.pdf" });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ success: false, error: "unknown session path" });
  });

  it("403s on path traversal", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/file/raw?cwd=${encodeURIComponent(tmp)}&path=${encodeURIComponent("../etc/passwd")}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ success: false, error: "path outside working directory" });
  });

  it("400s when cwd or path is missing", async () => {
    const res = await app.inject({ method: "GET", url: "/api/file/raw?cwd=" + encodeURIComponent(tmp) });
    expect(res.statusCode).toBe(400);
  });

  it("404s when the file does not exist", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/file/raw?cwd=${encodeURIComponent(tmp)}&path=missing.pdf`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("serves a PDF with application/pdf and inline disposition", async () => {
    const pdfBytes = Buffer.from("%PDF-1.4\n%fake\n", "utf8");
    await fsp.writeFile(path.join(tmp, "foo.pdf"), pdfBytes);
    const res = await app.inject({
      method: "GET",
      url: `/api/file/raw?cwd=${encodeURIComponent(tmp)}&path=foo.pdf`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe("inline");
    expect(res.headers["accept-ranges"]).toBe("bytes");
    expect(res.headers["content-length"]).toBe(String(pdfBytes.length));
    expect(res.rawPayload.equals(pdfBytes)).toBe(true);
  });

  it("serves PNG with image/png", async () => {
    await fsp.writeFile(path.join(tmp, "img.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const res = await app.inject({
      method: "GET",
      url: `/api/file/raw?cwd=${encodeURIComponent(tmp)}&path=img.png`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
  });

  it("returns 206 + Content-Range for a byte range request", async () => {
    const body = Buffer.from("0123456789abcdef", "utf8"); // 16 bytes
    await fsp.writeFile(path.join(tmp, "clip.mp4"), body);
    const res = await app.inject({
      method: "GET",
      url: `/api/file/raw?cwd=${encodeURIComponent(tmp)}&path=clip.mp4`,
      headers: { range: "bytes=4-9" },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers["content-range"]).toBe("bytes 4-9/16");
    expect(res.headers["content-length"]).toBe("6");
    expect(res.rawPayload.toString("utf8")).toBe("456789");
  });

  it("returns 416 on unsatisfiable range", async () => {
    await fsp.writeFile(path.join(tmp, "x.bin"), Buffer.alloc(8));
    const res = await app.inject({
      method: "GET",
      url: `/api/file/raw?cwd=${encodeURIComponent(tmp)}&path=x.bin`,
      headers: { range: "bytes=100-200" },
    });
    expect(res.statusCode).toBe(416);
    expect(res.headers["content-range"]).toBe("bytes */8");
  });
});

describe("GET /api/file/raw — git-root widening", () => {
  let app: FastifyInstance;
  let repo: string;
  let worktree: string;

  beforeEach(async () => {
    repo = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "raw-wt-")));
    await git(repo, "init", "-q");
    await git(repo, "config", "user.email", "t@t.t");
    await git(repo, "config", "user.name", "t");
    await fsp.writeFile(path.join(repo, "root.bin"), Buffer.from([1, 2, 3, 4]));
    await git(repo, "add", ".");
    await git(repo, "commit", "-q", "-m", "init");
    worktree = path.join(repo, ".worktrees", "wt");
    await git(repo, "worktree", "add", "-q", worktree);
    app = makeApp([worktree]);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fsp.rm(repo, { recursive: true, force: true });
  });

  it("streams a parent-root file for a worktree cwd (widened rule)", async () => {
    const target = path.join(repo, "root.bin");
    const res = await app.inject({
      method: "GET",
      url: `/api/file/raw?cwd=${encodeURIComponent(worktree)}&path=${encodeURIComponent(target)}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(Buffer.from([1, 2, 3, 4]))).toBe(true);
  });
});

describe("GET /api/file/render (AsciiDoc)", () => {
  let app: FastifyInstance;
  let tmp: string;

  beforeEach(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "file-render-"));
    app = makeApp([tmp]);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("rejects non-AsciiDoc extensions with HTTP 400", async () => {
    await fsp.writeFile(path.join(tmp, "x.md"), "# hi");
    const res = await app.inject({
      method: "GET",
      url: `/api/file/render?cwd=${encodeURIComponent(tmp)}&path=x.md`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ success: false, error: "renderer not supported for extension" });
  });

  it("accepts .adoc and returns sanitized HTML", async () => {
    await fsp.writeFile(path.join(tmp, "notes.adoc"), "= Title\n\nHello *world*.");
    const res = await app.inject({
      method: "GET",
      url: `/api/file/render?cwd=${encodeURIComponent(tmp)}&path=notes.adoc`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.html).toBe("string");
    expect(body.data.html).toContain("Hello");
    expect(body.data.html).toContain("<strong>world</strong>");
  });

  it("accepts .asciidoc extension", async () => {
    await fsp.writeFile(path.join(tmp, "n.asciidoc"), "hello");
    const res = await app.inject({
      method: "GET",
      url: `/api/file/render?cwd=${encodeURIComponent(tmp)}&path=n.asciidoc`,
    });
    expect(res.statusCode).toBe(200);
  });

  it("neutralizes a malicious include directive in safe mode", async () => {
    // In safe:"secure" mode asciidoctor refuses include::… and renders a
    // visible error / leaves the directive uninterpreted — the contents of
    // /etc/passwd MUST NOT appear in the output.
    await fsp.writeFile(path.join(tmp, "evil.adoc"), "= Evil\n\ninclude::/etc/passwd[]\n");
    const res = await app.inject({
      method: "GET",
      url: `/api/file/render?cwd=${encodeURIComponent(tmp)}&path=evil.adoc`,
    });
    expect(res.statusCode).toBe(200);
    const html = res.json().data.html as string;
    // The actual /etc/passwd contents (typically contain "root:") must not
    // appear. Asciidoctor secure mode emits an error stub or leaves the
    // directive uninterpreted; either is acceptable.
    expect(html).not.toMatch(/root:.*:0:0:/);
  });

  it("403s for unknown cwd", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/file/render?cwd=/nope&path=x.adoc",
    });
    expect(res.statusCode).toBe(403);
  });

  it("404s when the file does not exist", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/file/render?cwd=${encodeURIComponent(tmp)}&path=missing.adoc`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("403s on traversal", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/file/render?cwd=${encodeURIComponent(tmp)}&path=${encodeURIComponent("../foo.adoc")}`,
    });
    expect(res.statusCode).toBe(403);
  });
});
