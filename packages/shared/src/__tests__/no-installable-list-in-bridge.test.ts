/**
 * Contract test: the bridge auto-spawn code path (server-launcher.ts) must
 * NOT import from `installable-list`. Only Electron seeds `installable.json`
 * on first run; Bridge and Standalone starters must not produce or consume
 * that file.
 *
 * This is a static source scan — no runtime execution. If this test fails,
 * a dependency on installable-list was accidentally added to the bridge
 * launcher which would break the "file-absent is a no-op" contract on
 * Bridge/Standalone bootstraps.
 *
 * See change: simplify-electron-bootstrap-derived-state (task 5.7).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");

/** Files that form the bridge auto-spawn contract. */
const BRIDGE_SPAWN_FILES: readonly string[] = [
  "packages/extension/src/server-launcher.ts",
  "packages/extension/src/server-auto-start.ts",
  "packages/extension/src/connection.ts",
];

describe("bridge auto-spawn does not reference installable-list", () => {
  for (const rel of BRIDGE_SPAWN_FILES) {
    it(`${rel} does not import from installable-list`, () => {
      const file = path.resolve(repoRoot, rel);
      if (!fs.existsSync(file)) {
        // File absent (optional extension file) — contract trivially satisfied.
        return;
      }
      const source = fs.readFileSync(file, "utf-8");

      // Strip line comments before checking so a commented-out import
      // does not trigger a false positive.
      const stripped = source
        .replace(/\/\/[^\n]*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");

      expect(
        stripped,
        `${rel} must not import from "installable-list" — only Electron seeds installable.json. ` +
          `Bridge/Standalone starters must not produce or consume that file.`,
      ).not.toMatch(/installable-list/);
    });
  }
});
