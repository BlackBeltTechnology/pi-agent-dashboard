/**
 * Build guard: the full @mdi/js icon set (~2.6 MB raw) must live in its own
 * `mdi-*.js` chunk, NOT inline in the eager `index` entry chunk. Also caps the
 * gzipped entry chunk so a future refactor that re-inlines the icons fails
 * loudly. Build-independent: skips when no production build is present (the CI
 * pipeline runs `npm run build` first).
 *
 * See change: shrink-client-index-chunk (test-plan #S1).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

// A minified-survivable @mdi/js export name, used as the marker for the full
// icon set: present in the `mdi` chunk, absent from the entry chunk.
const MDI_MARKER = "mdiZodiacAquarius";
const INDEX_GZ_CAP_BYTES = 900 * 1024;

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

describe("@mdi/js is split out of the eager index entry chunk (test-plan #S1)", () => {
  it("emits a dedicated mdi-*.js chunk", () => {
    if (!existsSync(assetsDir)) return; // no build output — CI builds first
    const mdiChunks = readdirSync(assetsDir).filter((f) => /^mdi-/.test(f) && f.endsWith(".js"));
    expect(mdiChunks.length, "expected a mdi-*.js chunk from the manualChunks entry").toBeGreaterThan(0);
  });

  it("keeps @mdi/js out of the main entry chunk", () => {
    const entry = entryChunkPath();
    if (!entry || !existsSync(entry)) return; // no build output — CI builds first
    expect(readFileSync(entry, "utf8")).not.toContain(MDI_MARKER);
  });

  it("keeps the gzipped index entry chunk under the cap", () => {
    const entry = entryChunkPath();
    if (!entry || !existsSync(entry)) return; // no build output — CI builds first
    const gzipped = gzipSync(readFileSync(entry)).length;
    const kb = (gzipped / 1024).toFixed(0);
    expect(
      gzipped,
      `index entry chunk ${kb} KB gzipped exceeds the ${INDEX_GZ_CAP_BYTES / 1024} KB cap`,
    ).toBeLessThanOrEqual(INDEX_GZ_CAP_BYTES);
  });
});
