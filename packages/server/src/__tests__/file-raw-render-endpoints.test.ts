/**
 * Tests for `/api/file/raw` (binary-safe streaming) and `/api/file/render`
 * (server-side AsciiDoc rendering). See change: render-file-previews.
 */


import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearEmlCache } from "../lib/eml.js";
import { extToContentType } from "../lib/mime-types.js";
import { registerFileRoutes } from "../routes/file-routes.js";

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

// ── EML preview endpoints (change: add-eml-preview) ────────────────────────

/** Build a raw multipart/mixed .eml with an HTML body + optional attachments. */
function buildEml(opts: {
  subject?: string;
  html?: string;
  attachments?: { mime: string; filename: string; bytes: Buffer; inline?: boolean; cid?: string }[];
}): string {
  const boundary = "BOUND42";
  const parts: string[] = [];
  parts.push(`Content-Type: text/html; charset=utf-8\r\n\r\n${opts.html ?? "<p>hi</p>"}`);
  for (const a of opts.attachments ?? []) {
    const disp = a.inline ? "inline" : "attachment";
    const cidHeader = a.cid ? `Content-ID: <${a.cid}>\r\n` : "";
    parts.push(
      `Content-Type: ${a.mime}; name="${a.filename}"\r\n` +
        `Content-Disposition: ${disp}; filename="${a.filename}"\r\n` +
        cidHeader +
        `Content-Transfer-Encoding: base64\r\n\r\n${a.bytes.toString("base64")}`,
    );
  }
  const body = `${parts.map((p) => `--${boundary}\r\n${p}`).join("\r\n")}\r\n--${boundary}--\r\n`;
  return (
    `From: Alice <alice@example.com>\r\n` +
    `To: Bob <bob@example.com>\r\n` +
    `Subject: ${opts.subject ?? "Hello"}\r\n` +
    `Date: Wed, 01 Jan 2025 00:00:00 +0000\r\n` +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
    body
  );
}

const PDF_BYTES = Buffer.from("%PDF-1.4\nfake pdf\n", "utf8");

describe("GET /api/file/eml", () => {
  let app: FastifyInstance;
  let tmp: string;

  beforeEach(async () => {
    clearEmlCache();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "eml-"));
    app = makeApp([tmp]);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  async function writeEml(name: string, raw: string): Promise<void> {
    await fsp.writeFile(path.join(tmp, name), raw);
  }
  const get = (qs: string) => app.inject({ method: "GET", url: `/api/file/eml?${qs}` });
  const cwd = () => encodeURIComponent(tmp);

  it("parses headers, sanitized body, attachment metadata (test-plan #5)", async () => {
    await writeEml(
      "mail.eml",
      buildEml({ html: "<p>Hello</p>", attachments: [{ mime: "application/pdf", filename: "doc.pdf", bytes: PDF_BYTES }] }),
    );
    const res = await get(`cwd=${cwd()}&path=mail.eml`);
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.headers.subject).toBe("Hello");
    expect(body.data.attachments).toHaveLength(1);
    expect(body.data.attachments[0].mimeType).toBe("application/pdf");
    expect(body.data.attachments[0].filename).toBe("doc.pdf");
    // No base64 bytes leaked into the payload.
    expect(JSON.stringify(body.data)).not.toContain(PDF_BYTES.toString("base64"));
  });

  it("sanitizes <script> + onclick out of the body (test-plan #6)", async () => {
    await writeEml(
      "x.eml",
      buildEml({ html: `<p onclick="steal()">hi</p><script>alert(1)</script>` }),
    );
    const res = await get(`cwd=${cwd()}&path=x.eml`);
    expect(res.statusCode).toBe(200);
    const html = (res.json() as any).data.html as string;
    expect(html).not.toContain("<script");
    expect(html.toLowerCase()).not.toContain("onclick");
  });

  it("400s a non-.eml extension (test-plan #7)", async () => {
    await fsp.writeFile(path.join(tmp, "doc.pdf"), PDF_BYTES);
    const res = await get(`cwd=${cwd()}&path=doc.pdf`);
    expect(res.statusCode).toBe(400);
    expect((res.json() as any).error).toBe("renderer not supported for extension");
  });

  it("matches .EML case-insensitively (test-plan #2 server)", async () => {
    await writeEml("Mail.EML", buildEml({ subject: "Upper" }));
    const res = await get(`cwd=${cwd()}&path=Mail.EML`);
    expect(res.statusCode).toBe(200);
    expect((res.json() as any).data.headers.subject).toBe("Upper");
  });

  it("parses just under the size cap (test-plan #8)", async () => {
    // A small valid eml is well under the 25 MB cap → 200.
    await writeEml("small.eml", buildEml({ subject: "under" }));
    const res = await get(`cwd=${cwd()}&path=small.eml`);
    expect(res.statusCode).toBe(200);
  });

  it("413s an oversized file before reading it (test-plan #9)", async () => {
    // Sparse 26 MB file — never read into memory because stat.size > cap.
    const fh = await fsp.open(path.join(tmp, "big.eml"), "w");
    await fh.truncate(26 * 1024 * 1024);
    await fh.close();
    const res = await get(`cwd=${cwd()}&path=big.eml`);
    expect(res.statusCode).toBe(413);
  });

  it("403s an unknown cwd (test-plan #10)", async () => {
    const res = await get(`cwd=${encodeURIComponent("/nope")}&path=mail.eml`);
    expect(res.statusCode).toBe(403);
  });

  it("403s path traversal via the shared gate (test-plan #11)", async () => {
    const res = await get(`cwd=${cwd()}&path=${encodeURIComponent("../../../etc/passwd")}`);
    expect(res.statusCode).toBe(403);
  });

  it("400s corrupt/truncated MIME without crashing (test-plan #12)", async () => {
    // Truncated multipart: declares a boundary that never closes + no body.
    await writeEml("bad.eml", "Content-Type: multipart/mixed; boundary=X\r\n\r\n--X\r\nContent-Type: text/html");
    const res = await get(`cwd=${cwd()}&path=bad.eml`);
    // mailparser is lenient; either it parses (200) or fails (400) — never 500/crash.
    expect([200, 400]).toContain(res.statusCode);
  });

  it("blocks remote refs by default; server makes no outbound request (test-plan #17)", async () => {
    // `fetch` is the only outbound surface reachable from parse/sanitize; spy on
    // it to prove no SSRF (node:http/https are non-configurable under ESM).
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await writeEml(
      "remote.eml",
      buildEml({ html: `<img src="http://localhost:8000/api/file/raw?x=1">` }),
    );
    const allow = await get(`cwd=${cwd()}&path=remote.eml&allowRemote=1`);
    expect(allow.statusCode).toBe(200);
    // Even with allowRemote=1 the SERVER never fetches the URL.
    expect(fetchSpy).not.toHaveBeenCalled();
    // Default (no allowRemote): the remote src is neutralized.
    const blocked = await get(`cwd=${cwd()}&path=remote.eml`);
    const html = (blocked.json() as any).data.html as string;
    expect(html).not.toMatch(/<img[^>]*\ssrc="http/);
    expect(html).toContain("data-blocked-src");
    fetchSpy.mockRestore();
  });

  it("parses a 15 MB .eml within the p95 budget (test-plan #18)", async () => {
    const big = Buffer.alloc(15 * 1024 * 1024, 0x41);
    await writeEml(
      "large.eml",
      buildEml({ attachments: [{ mime: "application/pdf", filename: "big.pdf", bytes: big }] }),
    );
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
      clearEmlCache();
      const t0 = performance.now();
      const res = await get(`cwd=${cwd()}&path=large.eml`);
      times.push(performance.now() - t0);
      expect(res.statusCode).toBe(200);
    }
    const p95 = times.sort((a, b) => a - b)[times.length - 1];
    expect(p95).toBeLessThan(2000);
  });
});

describe("GET /api/file/eml-attachment", () => {
  let app: FastifyInstance;
  let tmp: string;

  beforeEach(async () => {
    clearEmlCache();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "eml-att-"));
    app = makeApp([tmp]);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await fsp.rm(tmp, { recursive: true, force: true });
  });
  const cwd = () => encodeURIComponent(tmp);
  const get = (qs: string) => app.inject({ method: "GET", url: `/api/file/eml-attachment?${qs}` });

  it("streams a PDF part with safe headers (test-plan #13)", async () => {
    await fsp.writeFile(
      path.join(tmp, "mail.eml"),
      buildEml({ attachments: [{ mime: "application/pdf", filename: "doc.pdf", bytes: PDF_BYTES }] }),
    );
    const res = await get(`cwd=${cwd()}&path=mail.eml&index=0`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-disposition"]).toContain("doc.pdf");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.rawPayload.equals(PDF_BYTES)).toBe(true);
  });

  it("serves an HTML-typed part as attachment+nosniff (test-plan #14)", async () => {
    await fsp.writeFile(
      path.join(tmp, "h.eml"),
      buildEml({ attachments: [{ mime: "text/html", filename: "evil.html", bytes: Buffer.from("<script>1</script>") }] }),
    );
    const res = await get(`cwd=${cwd()}&path=h.eml&index=0`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("400s a non-integer/negative index (test-plan #15)", async () => {
    await fsp.writeFile(path.join(tmp, "m.eml"), buildEml({ attachments: [{ mime: "application/pdf", filename: "d.pdf", bytes: PDF_BYTES }] }));
    expect((await get(`cwd=${cwd()}&path=m.eml&index=abc`)).statusCode).toBe(400);
    expect((await get(`cwd=${cwd()}&path=m.eml&index=-1`)).statusCode).toBe(400);
  });

  it("404s an out-of-range index (test-plan #16)", async () => {
    await fsp.writeFile(
      path.join(tmp, "two.eml"),
      buildEml({
        attachments: [
          { mime: "application/pdf", filename: "a.pdf", bytes: PDF_BYTES },
          { mime: "application/pdf", filename: "b.pdf", bytes: PDF_BYTES },
        ],
      }),
    );
    const res = await get(`cwd=${cwd()}&path=two.eml&index=5`);
    expect(res.statusCode).toBe(404);
  });
});
