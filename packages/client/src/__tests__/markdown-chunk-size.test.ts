/**
 * CI size guard for the merged `markdown` chunk.
 *
 * `fix-vite-build-warnings` folds `react-syntax-highlighter` into the
 * `markdown` manualChunk (removing the `syntax → markdown → syntax` circular
 * chunk). That grows the chunk to ~328 KB gzipped today (109 KB markdown +
 * 226 KB highlighter). This guard warns at 380 KB gz and fails above a 450 KB
 * gz hard cap so the merge cannot silently balloon. Skips when no production
 * build is present so the unit run stays build-independent — the gate bites in
 * CI where `npm run build` runs first.
 *
 * See change: fix-vite-build-warnings (test-plan #S4).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const WARN_BYTES = 380 * 1024;
const FAIL_BYTES = 450 * 1024;

const here = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.resolve(here, "../../dist/assets");

describe("markdown merged chunk size guard", () => {
  it("keeps the gzipped markdown chunk under the CI budget", () => {
    if (!existsSync(assetsDir)) {
      // No build output — nothing to measure. The CI pipeline builds first.
      return;
    }
    const markdownChunks = readdirSync(assetsDir).filter((f) => /^markdown-/.test(f) && f.endsWith(".js"));
    if (markdownChunks.length === 0) {
      // A build ran (assets present) but no markdown chunk matched — a rename
      // or merge into another chunk would silently disable this guard. Fail
      // loudly so the regression surfaces instead of passing green.
      expect.fail(
        "dist/assets exists but no markdown chunk (/^markdown-/ *.js) was emitted — the chunk may have been renamed or merged, disabling the size guard.",
      );
    }

    let gzipped = 0;
    for (const file of markdownChunks) {
      gzipped += gzipSync(readFileSync(path.join(assetsDir, file))).length;
    }

    const kb = (gzipped / 1024).toFixed(0);
    if (gzipped > WARN_BYTES) {
      console.warn(`[markdown-chunk-size] markdown chunk is ${kb} KB gzipped (warn budget 380 KB).`);
    }
    expect(gzipped, `markdown chunk ${kb} KB gzipped exceeds the 450 KB hard cap`).toBeLessThanOrEqual(FAIL_BYTES);
  });
});
