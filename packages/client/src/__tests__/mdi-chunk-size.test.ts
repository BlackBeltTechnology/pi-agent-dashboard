/**
 * Build guard: the full @mdi/js icon set (~2.78 MB raw) must NOT be part of
 * the cold-landing load. The landing graph is `index.html`'s entry script plus
 * its `modulepreload` hrefs, closed over the static `import"./x.js"` /
 * `from"./x.js"` specifiers of each chunk. No chunk in that graph may carry
 * the full-set marker, yet a separately loadable chunk must (the lazy set
 * behind `useMdiIconByKey`). Also caps the gzipped entry chunk.
 *
 * Build-conditional: skips when no production build is present (CI builds
 * first).
 *
 * See change: shrink-client-index-chunk (test-plan #S1);
 * harden-ios-safari-memory-and-ws-diagnostics (test-plan #E1).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

// A minified-survivable @mdi/js export name that no shell code imports by
// name — present only in a chunk that carries the FULL icon set.
const MDI_MARKER = "mdiZodiacAquarius";
const INDEX_GZ_CAP_BYTES = 900 * 1024;

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, "../../dist");
const assetsDir = path.join(distDir, "assets");
const indexHtmlPath = path.join(distDir, "index.html");

const basenameOf = (href: string): string => href.split("/").pop() ?? "";

function readIndexHtml(): string | null {
  return existsSync(indexHtmlPath) ? readFileSync(indexHtmlPath, "utf8") : null;
}

function entryChunk(html: string): string | null {
  const m = /<script[^>]+type="module"[^>]+src="([^"]+)"/i.exec(html);
  return m ? basenameOf(m[1]) : null;
}

/** Entry + modulepreload chunks, closed over static relative imports. */
function landingGraph(html: string): Set<string> {
  const roots = [
    ...[...html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/gi)].map((m) => m[1]),
    ...[...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/gi)].map((m) => m[1]),
  ].map(basenameOf);
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    const full = path.join(assetsDir, file);
    if (!existsSync(full)) continue;
    seen.add(file);
    const src = readFileSync(full, "utf8");
    // Static imports only: `import"./x.js"` / `from"./x.js"`. Dynamic
    // `import("./x.js")` is a lazy boundary and deliberately not followed.
    for (const m of src.matchAll(/(?:\bimport|\bfrom)\s*["']\.\/([^"']+\.js)["']/g)) queue.push(m[1]);
  }
  return seen;
}

describe("@mdi/js full icon set is off the cold landing (test-plan #E1)", () => {
  it("no chunk in the landing graph contains the full icon set", () => {
    const html = readIndexHtml();
    if (!html) return; // no build output — CI builds first
    const graph = landingGraph(html);
    expect(graph.size).toBeGreaterThan(0);
    const offenders = [...graph].filter((f) => readFileSync(path.join(assetsDir, f), "utf8").includes(MDI_MARKER));
    expect(offenders, `landing-graph chunk(s) carry the full @mdi/js set: ${offenders.join(", ")}`).toEqual([]);
  });

  it("emits a separately loadable chunk containing the full icon set", () => {
    const html = readIndexHtml();
    if (!html) return;
    const graph = landingGraph(html);
    const lazy = readdirSync(assetsDir)
      .filter((f) => f.endsWith(".js") && !graph.has(f))
      .filter((f) => readFileSync(path.join(assetsDir, f), "utf8").includes(MDI_MARKER));
    expect(lazy.length, "expected a lazy chunk carrying the full @mdi/js set").toBeGreaterThan(0);
  });

  it("keeps the gzipped index entry chunk under the cap", () => {
    const html = readIndexHtml();
    const entry = html ? entryChunk(html) : null;
    if (!entry || !existsSync(path.join(assetsDir, entry))) return;
    const gzipped = gzipSync(readFileSync(path.join(assetsDir, entry))).length;
    const kb = (gzipped / 1024).toFixed(0);
    expect(
      gzipped,
      `index entry chunk ${kb} KB gzipped exceeds the ${INDEX_GZ_CAP_BYTES / 1024} KB cap`,
    ).toBeLessThanOrEqual(INDEX_GZ_CAP_BYTES);
  });
});
