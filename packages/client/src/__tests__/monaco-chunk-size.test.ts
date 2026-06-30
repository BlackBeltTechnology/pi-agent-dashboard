/**
 * CI size guard for the lazily-loaded Monaco chunk.
 *
 * Warns when the gzipped Monaco chunk exceeds 2 MB and fails the build above
 * 3 MB (design §4). Skips when no production build is present so the unit run
 * stays build-independent — the gate bites in CI where `npm run build` runs
 * first.
 *
 * See change: add-internal-monaco-editor-pane (task 4.8).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const WARN_BYTES = 2 * 1024 * 1024;
const FAIL_BYTES = 3 * 1024 * 1024;

const here = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.resolve(here, "../../dist/assets");

describe("Monaco lazy chunk size guard", () => {
  it("keeps the gzipped Monaco chunk under the CI budget", () => {
    if (!existsSync(assetsDir)) {
      // No build output — nothing to measure. The CI pipeline builds first.
      return;
    }
    const monacoChunks = readdirSync(assetsDir).filter((f) => /monaco/i.test(f) && f.endsWith(".js"));
    if (monacoChunks.length === 0) {
      // Build present but Monaco not emitted (e.g. tree-shaken in a partial
      // build) — don't assert against a missing artifact.
      return;
    }

    let gzipped = 0;
    for (const file of monacoChunks) {
      gzipped += gzipSync(readFileSync(path.join(assetsDir, file))).length;
    }

    const mb = (gzipped / 1024 / 1024).toFixed(2);
    if (gzipped > WARN_BYTES) {
      console.warn(`[monaco-chunk-size] Monaco chunk is ${mb} MB gzipped (warn budget 2 MB).`);
    }
    expect(gzipped, `Monaco chunk ${mb} MB gzipped exceeds the 3 MB hard cap`).toBeLessThanOrEqual(FAIL_BYTES);
  });
});
