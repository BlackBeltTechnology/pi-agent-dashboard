/**
 * Build guard: the server-only EML deps (`mailparser`, `isomorphic-dompurify`)
 * must NEVER land in the client main entry chunk — EML parsing/sanitization is
 * server-side. Also asserts pdfjs stays lazy (its own chunk, not the entry).
 * Build-independent: skips when no production build is present (the CI pipeline
 * runs `npm run build` first). See change: add-eml-preview (test-plan #21).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, "../../dist");
const assetsDir = path.join(distDir, "assets");

/** Resolve the main entry chunk file from index.html's module script. */
function entryChunkPath(): string | null {
  const indexHtml = path.join(distDir, "index.html");
  if (!existsSync(indexHtml)) return null;
  const html = readFileSync(indexHtml, "utf8");
  const m = /<script[^>]+type="module"[^>]+src="([^"]+)"/i.exec(html);
  if (!m) return null;
  const rel = m[1].replace(/^\//, "");
  return path.join(distDir, rel);
}

describe("EML deps stay out of the client main bundle", () => {
  it("main entry chunk excludes mailparser + isomorphic-dompurify", () => {
    const entry = entryChunkPath();
    if (!entry || !existsSync(entry)) return; // no build output — CI builds first
    const src = readFileSync(entry, "utf8");
    expect(src).not.toContain("mailparser");
    expect(src).not.toContain("isomorphic-dompurify");
  });

  it("keeps pdfjs in a lazy chunk, not the main entry", () => {
    if (!existsSync(assetsDir)) return;
    const entry = entryChunkPath();
    if (!entry || !existsSync(entry)) return;
    const pdfChunks = readdirSync(assetsDir).filter((f) => /pdf/i.test(f) && f.endsWith(".js"));
    // A pdfjs chunk exists AND it is not the entry chunk (lazy-loaded).
    expect(pdfChunks.length).toBeGreaterThan(0);
    expect(pdfChunks.map((f) => path.join(assetsDir, f))).not.toContain(entry);
  });
});

/**
 * Chunk-topology guards for the manualChunks merge (change:
 * fix-vite-build-warnings). react-syntax-highlighter is folded into the
 * `markdown` chunk (was a standalone `syntax` chunk → circular-chunk warning),
 * and the viewer-registry PdfPreview import is now lazy (Option B) so the
 * PdfPreview component stays out of the main entry chunk.
 */
describe("manualChunks topology after fix-vite-build-warnings", () => {
  // A string literal unique to PdfPreview.tsx that survives minification, used
  // as the module marker: present in the lazy PdfPreview chunk, absent from the
  // main entry chunk once viewer-registry imports it lazily.
  const PDF_PREVIEW_MARKER = "failed to render page";

  it("folds react-syntax-highlighter into markdown: no standalone syntax chunk (test-plan #S2)", () => {
    if (!existsSync(assetsDir)) return; // no build output — CI builds first
    const jsChunks = readdirSync(assetsDir).filter((f) => f.endsWith(".js"));
    const syntaxChunks = jsChunks.filter((f) => /^syntax-/.test(f));
    const markdownChunks = jsChunks.filter((f) => /^markdown-/.test(f));
    expect(syntaxChunks, `unexpected standalone syntax chunk(s): ${syntaxChunks.join(", ")}`).toHaveLength(0);
    expect(markdownChunks.length, "expected a markdown-*.js chunk (highlighter folded in)").toBeGreaterThan(0);
  });

  it("keeps PdfPreview out of the main entry chunk (Option B lazy) (test-plan #S3)", () => {
    if (!existsSync(assetsDir)) return;
    const entry = entryChunkPath();
    if (!entry || !existsSync(entry)) return;
    // The PdfPreview component now lives in a lazy chunk, not the entry.
    expect(readFileSync(entry, "utf8")).not.toContain(PDF_PREVIEW_MARKER);
    const lazyWithMarker = readdirSync(assetsDir)
      .filter((f) => f.endsWith(".js") && path.join(assetsDir, f) !== entry)
      .some((f) => readFileSync(path.join(assetsDir, f), "utf8").includes(PDF_PREVIEW_MARKER));
    expect(lazyWithMarker, "expected a lazy chunk containing the PdfPreview module").toBe(true);
  });
});
