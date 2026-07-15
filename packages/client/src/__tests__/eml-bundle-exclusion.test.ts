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
