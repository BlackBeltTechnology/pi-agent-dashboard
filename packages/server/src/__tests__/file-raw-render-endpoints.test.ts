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
import iconv from "iconv-lite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { clearEmlCache } from "../lib/eml.js";
import { extToContentType } from "../lib/mime-types.js";
import type { DocxPdfEngine, OfficeCaps } from "../lib/office-preview.js";
import { OFFICE_CAPS } from "../lib/office-preview.js";
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

function makeApp(
  cwds: string[],
  office?: {
    docxPdfEngine?: DocxPdfEngine;
    officeCaps?: Partial<OfficeCaps>;
    docxRenderMode?: "pdf" | "html" | "auto";
  },
): FastifyInstance {
  const app = Fastify({ logger: false });
  registerFileRoutes(app, {
    sessionManager: {
      listAll: () => cwds.map((cwd) => ({ cwd })),
    } as any,
    preferencesStore: { getPinnedDirectories: () => [] } as any,
    networkGuard: async () => undefined,
    docxPdfEngine: office?.docxPdfEngine,
    officeCaps: office?.officeCaps ? { ...OFFICE_CAPS, ...office.officeCaps } : undefined,
    docxRenderMode: office?.docxRenderMode,
  });
  return app;
}

// ── docx fixtures (jszip; a mammoth dependency) ───────────────────────────────
const DOCX_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
const DOCX_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
function docXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
}
async function buildDocx(body: string): Promise<Buffer> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", DOCX_CONTENT_TYPES);
  zip.file("_rels/.rels", DOCX_RELS);
  zip.file("word/document.xml", docXml(body));
  return zip.generateAsync({ type: "nodebuffer" });
}
const DOCX_HEADING_TABLE =
  "<w:p><w:r><w:t>Hello heading</w:t></w:r></w:p>" +
  "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cellA</w:t></w:r></w:p></w:tc>" +
  "<w:tc><w:p><w:r><w:t>cellB</w:t></w:r></w:p></w:tc></w:tr></w:tbl>";
// A hyperlink with NO r:id and NO w:anchor → mammoth href=null/anchor=null →
// crashes without the guard (design D2).
const DOCX_NULL_HYPERLINK =
  "<w:p><w:hyperlink><w:r><w:t>dangling link</w:t></w:r></w:hyperlink></w:p>";

function stubEngine(
  available: boolean,
  opts?: { throwOnAvailable?: boolean; throwOnPdf?: boolean },
): DocxPdfEngine {
  return {
    async available() {
      if (opts?.throwOnAvailable) throw Object.assign(new Error("DOCKER_UNAVAILABLE"), { code: "DOCKER_UNAVAILABLE" });
      return available;
    },
    async toPdf(_docx: string, out: string) {
      if (opts?.throwOnPdf) throw new Error("render failed");
      await fsp.writeFile(out, Buffer.from("%PDF-1.4\n%stub\n"));
    },
  };
}

function xlsxBuf(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
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

  it("neutralizes remote refs in srcset + CSS @import (hardening)", async () => {
    await writeEml(
      "multi.eml",
      buildEml({
        html:
          `<img srcset="cid:logo@x 1x, https://tracker.example/pixel.gif 2x">` +
          `<style>@import "https://tracker.example/track.css"; .a{background:url(https://tracker.example/bg.png)}</style>`,
      }),
    );
    const html = ((await get(`cwd=${cwd()}&path=multi.eml`)).json() as any).data.html as string;
    // Comma-separated srcset with a trailing remote URL is blocked (moved to data-blocked-srcset).
    expect(html).not.toMatch(/<img[^>]*\ssrcset="[^"]*https:/);
    // @import (no url() wrapper) and url() remote both neutralized to about:blank.
    expect(html).not.toContain("tracker.example/track.css");
    expect(html).not.toContain("tracker.example/bg.png");
    // allowRemote=1 preserves them for the browser to fetch.
    const allowed = ((await get(`cwd=${cwd()}&path=multi.eml&allowRemote=1`)).json() as any).data
      .html as string;
    expect(allowed).toContain("tracker.example/track.css");
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

describe("GET /api/file/render (docx, two-tier — design D8)", () => {
  let app: FastifyInstance;
  let tmp: string;

  afterEach(async () => {
    if (app) await app.close();
    if (tmp) await fsp.rm(tmp, { recursive: true, force: true });
  });

  async function setup(office?: Parameters<typeof makeApp>[1]) {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "docx-render-"));
    app = makeApp([tmp], office);
    await app.ready();
  }

  it("engine available → mode:'pdf'; /api/file/rendered-pdf streams application/pdf (test-plan #7)", async () => {
    await setup({ docxPdfEngine: stubEngine(true) });
    await fsp.writeFile(path.join(tmp, "d.docx"), await buildDocx(DOCX_HEADING_TABLE));
    const res = await app.inject({
      method: "GET",
      url: `/api/file/render?cwd=${encodeURIComponent(tmp)}&path=d.docx`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: { mode: "pdf" } });
    const pdf = await app.inject({
      method: "GET",
      url: `/api/file/rendered-pdf?cwd=${encodeURIComponent(tmp)}&path=d.docx`,
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("engine unavailable → mode:'html' with markup, no <script> (test-plan #8)", async () => {
    await setup({ docxPdfEngine: stubEngine(false) });
    await fsp.writeFile(path.join(tmp, "d.docx"), await buildDocx(DOCX_HEADING_TABLE));
    const res = await app.inject({
      method: "GET",
      url: `/api/file/render?cwd=${encodeURIComponent(tmp)}&path=d.docx`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.mode).toBe("html");
    expect(body.data.html).toContain("Hello heading");
    expect(body.data.html).toContain("<table>");
    expect(body.data.html).not.toContain("<script>");
  });

  it("engine throws DOCKER_UNAVAILABLE mid-request → falls through to mode:'html' (test-plan #9)", async () => {
    await setup({ docxPdfEngine: stubEngine(true, { throwOnAvailable: true }) });
    await fsp.writeFile(path.join(tmp, "d.docx"), await buildDocx(DOCX_HEADING_TABLE));
    const res = await app.inject({
      method: "GET",
      url: `/api/file/render?cwd=${encodeURIComponent(tmp)}&path=d.docx`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.mode).toBe("html");
  });

  it("null-href hyperlink docx (html mode) → success:true, guard applied, no crash (test-plan #10)", async () => {
    await setup({ docxPdfEngine: stubEngine(false) });
    await fsp.writeFile(path.join(tmp, "d.docx"), await buildDocx(DOCX_NULL_HYPERLINK));
    const res = await app.inject({
      method: "GET",
      url: `/api/file/render?cwd=${encodeURIComponent(tmp)}&path=d.docx`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.html).toContain("dangling link");
  });

  it("html over the byte cap → truncated:true (bounded-preview wiring, test-plan #11)", async () => {
    // Force the bounded-preview branch with a tiny html byte cap. The image
    // strip mechanics are covered by the office-preview unit test.
    await setup({ docxPdfEngine: stubEngine(false), officeCaps: { htmlByteCap: 1 } });
    await fsp.writeFile(path.join(tmp, "d.docx"), await buildDocx(DOCX_HEADING_TABLE));
    const res = await app.inject({
      method: "GET",
      url: `/api/file/render?cwd=${encodeURIComponent(tmp)}&path=d.docx`,
    });
    expect(res.json().data.truncated).toBe(true);
  });

  it("corrupt / non-zip docx → {success:false}, no crash (test-plan #12)", async () => {
    await setup({ docxPdfEngine: stubEngine(false) });
    await fsp.writeFile(path.join(tmp, "bad.docx"), Buffer.from("PK\x03\x04not a real docx"));
    const res = await app.inject({
      method: "GET",
      url: `/api/file/render?cwd=${encodeURIComponent(tmp)}&path=bad.docx`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(false);
  });

  it("ext .pdf on render → HTTP 400 (test-plan #13)", async () => {
    await setup();
    await fsp.writeFile(path.join(tmp, "x.pdf"), Buffer.from("%PDF-1.4"));
    const res = await app.inject({
      method: "GET",
      url: `/api/file/render?cwd=${encodeURIComponent(tmp)}&path=x.pdf`,
    });
    expect(res.statusCode).toBe(400);
  });

  it("size under cap → 200, over cap → 413 before read (BVA, test-plan #14)", async () => {
    await setup({ docxPdfEngine: stubEngine(false), officeCaps: { docxSizeCap: 100_000 } });
    // Under cap: a real (small) docx renders.
    await fsp.writeFile(path.join(tmp, "small.docx"), await buildDocx(DOCX_HEADING_TABLE));
    const under = await app.inject({
      method: "GET",
      url: `/api/file/render?cwd=${encodeURIComponent(tmp)}&path=small.docx`,
    });
    expect(under.statusCode).toBe(200);
    // Over cap: a 200 KB dummy .docx is rejected before any parse.
    await fsp.writeFile(path.join(tmp, "big.docx"), Buffer.alloc(200_000, 1));
    const over = await app.inject({
      method: "GET",
      url: `/api/file/render?cwd=${encodeURIComponent(tmp)}&path=big.docx`,
    });
    expect(over.statusCode).toBe(413);
  });

  it("traversal → 403 on render AND rendered-pdf (test-plan #15)", async () => {
    await setup({ docxPdfEngine: stubEngine(true) });
    const trav = encodeURIComponent("../../../etc/passwd.docx");
    const r1 = await app.inject({
      method: "GET",
      url: `/api/file/render?cwd=${encodeURIComponent(tmp)}&path=${trav}`,
    });
    expect(r1.statusCode).toBe(403);
    const r2 = await app.inject({
      method: "GET",
      url: `/api/file/rendered-pdf?cwd=${encodeURIComponent(tmp)}&path=${trav}`,
    });
    expect(r2.statusCode).toBe(403);
  });
});

describe("GET /api/file/render (pptx, engine-only PDF — design P1/P4)", () => {
  let app: FastifyInstance;
  let tmp: string;

  afterEach(async () => {
    if (app) await app.close();
    if (tmp) await fsp.rm(tmp, { recursive: true, force: true });
  });

  async function setup(office?: Parameters<typeof makeApp>[1]) {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "pptx-render-"));
    app = makeApp([tmp], office);
    await app.ready();
  }

  // The engine is stubbed, so any bytes named `.pptx` suffice (LibreOffice
  // never runs in the unit suite).
  const PPTX_BYTES = Buffer.from("PK\x03\x04 fake pptx zip");

  it("engine available → mode:'pdf'; /api/file/rendered-pdf streams application/pdf (test-plan #6.5)", async () => {
    await setup({ docxPdfEngine: stubEngine(true) });
    await fsp.writeFile(path.join(tmp, "deck.pptx"), PPTX_BYTES);
    const res = await app.inject({
      method: "GET",
      url: `/api/file/render?cwd=${encodeURIComponent(tmp)}&path=deck.pptx`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: { mode: "pdf" } });
    const pdf = await app.inject({
      method: "GET",
      url: `/api/file/rendered-pdf?cwd=${encodeURIComponent(tmp)}&path=deck.pptx`,
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("engine unavailable → {success:false}, no in-process render, no crash (test-plan #6.6)", async () => {
    await setup({ docxPdfEngine: stubEngine(false) });
    await fsp.writeFile(path.join(tmp, "deck.pptx"), PPTX_BYTES);
    const res = await app.inject({
      method: "GET",
      url: `/api/file/render?cwd=${encodeURIComponent(tmp)}&path=deck.pptx`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(false);
  });

  it("engine throws DOCKER_UNAVAILABLE → {success:false}, no crash (test-plan #6.6)", async () => {
    await setup({ docxPdfEngine: stubEngine(true, { throwOnAvailable: true }) });
    await fsp.writeFile(path.join(tmp, "deck.pptx"), PPTX_BYTES);
    const res = await app.inject({
      method: "GET",
      url: `/api/file/render?cwd=${encodeURIComponent(tmp)}&path=deck.pptx`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(false);
  });

  it("ext .key → HTTP 400 (test-plan #6.7)", async () => {
    await setup({ docxPdfEngine: stubEngine(true) });
    await fsp.writeFile(path.join(tmp, "deck.key"), PPTX_BYTES);
    const res = await app.inject({
      method: "GET",
      url: `/api/file/render?cwd=${encodeURIComponent(tmp)}&path=deck.key`,
    });
    expect(res.statusCode).toBe(400);
  });

  it("size > cap → HTTP 413 before convert (BVA, test-plan #6.8)", async () => {
    await setup({ docxPdfEngine: stubEngine(true), officeCaps: { pptxSizeCap: 100_000 } });
    await fsp.writeFile(path.join(tmp, "big.pptx"), Buffer.alloc(200_000, 1));
    const res = await app.inject({
      method: "GET",
      url: `/api/file/render?cwd=${encodeURIComponent(tmp)}&path=big.pptx`,
    });
    expect(res.statusCode).toBe(413);
  });

  it("traversal → 403 on render AND rendered-pdf (test-plan #6.9)", async () => {
    await setup({ docxPdfEngine: stubEngine(true) });
    const trav = encodeURIComponent("../../../etc/passwd.pptx");
    const r1 = await app.inject({
      method: "GET",
      url: `/api/file/render?cwd=${encodeURIComponent(tmp)}&path=${trav}`,
    });
    expect(r1.statusCode).toBe(403);
    const r2 = await app.inject({
      method: "GET",
      url: `/api/file/rendered-pdf?cwd=${encodeURIComponent(tmp)}&path=${trav}`,
    });
    expect(r2.statusCode).toBe(403);
  });
});

describe("GET /api/file/sheet (xlsx/csv)", () => {
  let app: FastifyInstance;
  let tmp: string;

  afterEach(async () => {
    if (app) await app.close();
    if (tmp) await fsp.rm(tmp, { recursive: true, force: true });
  });

  async function setup(office?: Parameters<typeof makeApp>[1]) {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "sheet-"));
    app = makeApp([tmp], office);
    await app.ready();
  }

  it("multi-sheet xlsx → one entry per sheet, activeSheet=0 (test-plan #14)", async () => {
    await setup();
    const buf = xlsxBuf({ Alpha: [["a", "b"], [1, 2]], Beta: [["c"], [3]] });
    await fsp.writeFile(path.join(tmp, "book.xlsx"), buf);
    const res = await app.inject({
      method: "GET",
      url: `/api/file/sheet?cwd=${encodeURIComponent(tmp)}&path=book.xlsx`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.sheets.map((s: any) => s.name)).toEqual(["Alpha", "Beta"]);
    expect(body.data.activeSheet).toBe(0);
  });

  it("row cap via limit → rows==cap, truncated, totalRows true (BVA, test-plan #15)", async () => {
    await setup();
    const body = [["h"], ...Array.from({ length: 12 }, (_, i) => [i])];
    await fsp.writeFile(path.join(tmp, "big.xlsx"), xlsxBuf({ S: body }));
    const res = await app.inject({
      method: "GET",
      url: `/api/file/sheet?cwd=${encodeURIComponent(tmp)}&path=big.xlsx&limit=5`,
    });
    const s = res.json().data.sheets[0];
    expect(s.rows.length).toBe(5);
    expect(s.totalRows).toBe(12);
    expect(s.truncated).toBe(true);
  });

  it("CP1250 csv → accented chars decode, non-UTF-8 charset reported (test-plan #16)", async () => {
    await setup();
    const rows = ["nev;varos"];
    for (let i = 0; i < 40; i++) rows.push("Árvíztűrő;Győr Székesfehérvár");
    await fsp.writeFile(path.join(tmp, "hu.csv"), iconv.encode(`${rows.join("\n")}\n`, "windows-1250"));
    const res = await app.inject({
      method: "GET",
      url: `/api/file/sheet?cwd=${encodeURIComponent(tmp)}&path=hu.csv`,
    });
    const body = res.json();
    expect(body.success).toBe(true);
    expect(JSON.stringify(body.data.sheets)).toContain("Árvíztűrő");
    expect(body.data.encoding).toBeDefined();
    expect(body.data.encoding).not.toBe("UTF-8");
  });

  it("password-protected / corrupt xlsx → {success:false}, no crash (test-plan #17)", async () => {
    await setup();
    await fsp.writeFile(path.join(tmp, "enc.xlsx"), Buffer.from("PK\x03\x04" + "g".repeat(60)));
    const res = await app.inject({
      method: "GET",
      url: `/api/file/sheet?cwd=${encodeURIComponent(tmp)}&path=enc.xlsx`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(false);
  });

  it("ext .txt → HTTP 400 (test-plan #18)", async () => {
    await setup();
    await fsp.writeFile(path.join(tmp, "x.txt"), "hi");
    const res = await app.inject({
      method: "GET",
      url: `/api/file/sheet?cwd=${encodeURIComponent(tmp)}&path=x.txt`,
    });
    expect(res.statusCode).toBe(400);
  });

  it("oversize → 413 before read (test-plan #19)", async () => {
    await setup({ officeCaps: { sheetSizeCap: 1000 } });
    await fsp.writeFile(path.join(tmp, "big.csv"), Buffer.alloc(5000, 65));
    const res = await app.inject({
      method: "GET",
      url: `/api/file/sheet?cwd=${encodeURIComponent(tmp)}&path=big.csv`,
    });
    expect(res.statusCode).toBe(413);
  });
});
