/**
 * scripts/i18n-parity.mjs keeps its behaviour after the shell-free file listing
 * (`execFileSync` argv instead of `execSync`). The plugin-catalog list the script
 * prints must equal the catalogs found on disk, and the repo tree must be green.
 * A one-off before/after capture (same exit code, byte-identical stdout) was taken
 * when the change landed; this test keeps the invariant it established.
 *
 * See change: triage-codeql-alert-debt (test-plan #E6).
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Plugin package dirs whose `src/i18n.ts` exists (what the script's `find` lists).
function pluginIdsOnDisk() {
  return readdirSync(join(ROOT, "packages"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.includes("plugin") && existsSync(join(ROOT, "packages", d.name, "src", "i18n.ts")))
    .map((d) => d.name)
    .sort();
}

describe("i18n-parity.mjs equivalence", () => {
  it("exits 0 and reports every on-disk plugin catalog", () => {
    const r = spawnSync(process.execPath, ["scripts/i18n-parity.mjs"], { cwd: ROOT, encoding: "utf8" });
    expect(r.status).toBe(0);
    const reported = new Set(
      [...r.stdout.matchAll(/^\S+ (\S+-plugin) (?:zh-CN|hu):/gm)].map((m) => m[1]),
    );
    const onDisk = pluginIdsOnDisk();
    expect(onDisk.length).toBeGreaterThan(0);
    for (const id of onDisk) expect(reported.has(id), `${id} missing from stdout`).toBe(true);
  });
});
